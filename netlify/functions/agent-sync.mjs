import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const CATEGORY_VALUES = new Set(['work', 'growth', 'family', 'health', 'other']);
const PRIORITY_VALUES = new Set(['high', 'medium', 'low']);

class NoopWebSocket {
  constructor() {
    throw new Error('Realtime is not used by the agent sync endpoint.');
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization',
    },
    body: JSON.stringify(body),
  };
}

function requireConfig() {
  const supabaseUrl = process.env.EFFECTIVE_TIME_SUPABASE_URL || process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.EFFECTIVE_TIME_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = process.env.AGENT_SYNC_TOKEN || process.env.EFFECTIVE_TIME_AGENT_TOKEN;
  const userId = process.env.EFFECTIVE_TIME_USER_ID || '';
  const userEmail = process.env.EFFECTIVE_TIME_USER_EMAIL || '';
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('同步入口还没有完成环境配置。');
  }
  return { supabaseUrl, serviceRoleKey, token, userId, userEmail };
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex');
}

function assertString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`缺少 ${name}`);
  return value.trim();
}

function normalizeCategory(value) {
  return CATEGORY_VALUES.has(value) ? value : 'other';
}

function normalizePriority(value) {
  return PRIORITY_VALUES.has(value) ? value : 'medium';
}

function dateRangeForLocalDay(day) {
  const date = assertString(day, '日期');
  return {
    start: new Date(`${date}T00:00:00+08:00`).toISOString(),
    end: new Date(`${date}T23:59:59.999+08:00`).toISOString(),
  };
}

function toIso(value, name) {
  const text = assertString(value, name);
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text) ? text.replace(' ', 'T') : text;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error(`${name} 不是有效时间：${value}`);
  return date.toISOString();
}

function secondsBetween(start, end) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
}

function markerFor(payload = {}) {
  const externalId = payload.external_id || payload.externalId || payload.idempotency_key || null;
  if (!externalId) return null;
  const source = payload.external_source || payload.sync_source || payload.source || 'agent';
  return `agent_sync:${encodeURIComponent(String(source))}:${encodeURIComponent(String(externalId))}`;
}

function noteWithMarker(note, marker) {
  const text = note ? String(note).trim() : '';
  if (!marker) return text || null;
  if (text.includes(marker)) return text;
  return [text, marker].filter(Boolean).join('\n');
}

async function findByMarker(supabase, table, userId, marker) {
  if (!marker) return null;
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .eq('user_id', userId)
    .ilike('note', `%${marker}%`)
    .limit(1);
  if (error) throw error;
  return data?.[0] || null;
}

async function resolveUserId(supabase, config) {
  if (config.userId) return config.userId;
  if (!config.userEmail) throw new Error('缺少默认用户身份。');
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const matched = data.users.find((user) => user.email?.toLowerCase() === config.userEmail.toLowerCase());
    if (matched) return matched.id;
    if (!data.users.length || data.users.length < 100) break;
  }
  throw new Error(`没有找到用户：${config.userEmail}`);
}

async function resolveAccess(supabase, config, providedToken) {
  if (!providedToken) throw new Error('缺少同步口令。');

  // Backward compatibility for the owner's private token.
  if (config.token && providedToken === config.token) {
    return { userId: await resolveUserId(supabase, config), mode: 'owner' };
  }

  const hash = tokenHash(providedToken);
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const matched = data.users.find((user) => {
      const agent = user.user_metadata?.effective_time_agent;
      return agent?.status === 'active' && agent?.token_hash === hash;
    });
    if (matched) {
      const agent = matched.user_metadata?.effective_time_agent || {};
      await supabase.auth.admin.updateUserById(matched.id, {
        user_metadata: {
          ...(matched.user_metadata || {}),
          effective_time_agent: {
            ...agent,
            last_used_at: new Date().toISOString(),
          },
        },
      });
      return { userId: matched.id, mode: 'user_agent', userEmail: matched.email || null };
    }
    if (!data.users.length || data.users.length < 100) break;
  }

  throw new Error('同步口令不正确，或已被撤销。');
}

async function resolveGoal(supabase, userId, payload = {}) {
  if (!payload.goal_id && !payload.goal_name) {
    return { goal_id: null, category: normalizeCategory(payload.category) };
  }
  let query = supabase.from('goals').select('*').eq('user_id', userId);
  if (payload.goal_id) query = query.eq('id', payload.goal_id);
  const { data, error } = await query;
  if (error) throw error;
  let goal = payload.goal_id ? data[0] : null;
  if (!goal && payload.goal_name) {
    const lower = payload.goal_name.toLowerCase();
    goal = data.find((item) => item.name.toLowerCase() === lower)
      || data.find((item) => item.name.toLowerCase().includes(lower));
  }
  if (!goal) throw new Error(`没有找到目标：${payload.goal_id || payload.goal_name}`);
  return { goal_id: goal.id, category: goal.category };
}

async function createGoal(supabase, userId, payload) {
  const goalPayload = {
    user_id: userId,
    name: assertString(payload.name, '目标名称'),
    category: normalizeCategory(payload.category),
    description: payload.description || null,
    color: payload.color || '#00B7BD',
    status: payload.status === 'inactive' ? 'inactive' : 'active',
  };
  const { data, error } = await supabase.from('goals').insert(goalPayload).select('*').single();
  if (error) throw error;
  return data;
}

async function createTask(supabase, userId, payload) {
  const goal = await resolveGoal(supabase, userId, payload);
  const marker = markerFor(payload);
  const existing = await findByMarker(supabase, 'tasks', userId, marker);
  const note = noteWithMarker(payload.note ?? existing?.note, marker);
  const taskPayload = {
    user_id: userId,
    title: assertString(payload.title, '任务名称'),
    goal_id: goal.goal_id,
    category: goal.category,
    due_time: payload.due_time ? toIso(payload.due_time, '截止时间') : null,
    estimated_minutes: payload.estimated_minutes ? Number(payload.estimated_minutes) : null,
    priority: normalizePriority(payload.priority),
    note,
  };
  if (existing) {
    const { data, error } = await supabase
      .from('tasks')
      .update(taskPayload)
      .eq('id', existing.id)
      .select('*')
      .single();
    if (error) throw error;
    return { sync: 'updated', task: data };
  }
  const { data, error } = await supabase.from('tasks').insert({
    ...taskPayload,
    status: 'not_started',
  }).select('*').single();
  if (error) throw error;
  return { sync: 'created', task: data };
}

async function listTasks(supabase, userId, payload = {}) {
  let query = supabase.from('tasks').select('*').eq('user_id', userId);
  if (payload.status) query = query.eq('status', payload.status);
  if (payload.goal_id) query = query.eq('goal_id', payload.goal_id);
  if (payload.due_start) query = query.gte('due_time', toIso(payload.due_start, '开始截止时间'));
  if (payload.due_end) query = query.lte('due_time', toIso(payload.due_end, '结束截止时间'));
  if (payload.query) query = query.ilike('title', `%${payload.query}%`);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(Math.min(Number(payload.limit || 80), 200));
  if (error) throw error;
  return data || [];
}

async function resolveTask(supabase, userId, payload = {}) {
  if (payload.task_id || payload.id) {
    const { data, error } = await supabase
      .from('tasks')
      .select('*')
      .eq('user_id', userId)
      .eq('id', payload.task_id || payload.id)
      .single();
    if (error) throw error;
    return data;
  }
  const title = payload.title || payload.task_title || payload.query;
  if (!title) throw new Error('请提供任务 ID 或任务名称。');
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .neq('status', 'completed')
    .ilike('title', `%${title}%`)
    .order('created_at', { ascending: false })
    .limit(5);
  if (error) throw error;
  if (!data?.length) throw new Error(`没有找到任务：${title}`);
  const exact = data.find((task) => task.title === title);
  return exact || data[0];
}

async function recalculateTaskDuration(supabase, taskId, patch = {}) {
  const { data, error } = await supabase
    .from('time_segments')
    .select('start_time,end_time,duration_seconds')
    .eq('source_type', 'task')
    .eq('source_id', taskId);
  if (error) throw error;
  const total = (data || []).reduce((sum, segment) => {
    if (!segment.end_time) return sum;
    return sum + (segment.duration_seconds || secondsBetween(segment.start_time, segment.end_time));
  }, 0);
  const result = await supabase.from('tasks').update({ total_duration_seconds: total, ...patch }).eq('id', taskId);
  if (result.error) throw result.error;
}

async function startTask(supabase, userId, payload) {
  const task = await resolveTask(supabase, userId, payload);
  if (task.status === 'completed') throw new Error('已完成的任务不能重新开始。');
  const running = await supabase
    .from('time_segments')
    .select('id')
    .eq('user_id', userId)
    .eq('source_type', 'task')
    .eq('source_id', task.id)
    .eq('is_running', true)
    .maybeSingle();
  if (running.error) throw running.error;
  if (running.data) throw new Error('这个任务已经在计时中。');
  const startedAt = payload.start_time ? toIso(payload.start_time, '开始时间') : new Date().toISOString();
  const { data, error } = await supabase.from('time_segments').insert({
    user_id: userId,
    source_type: 'task',
    source_id: task.id,
    goal_id: task.goal_id || null,
    category: task.category || 'other',
    title: task.title,
    start_time: startedAt,
    duration_seconds: 0,
    is_running: true,
    is_manual: false,
    note: task.note || null,
  }).select('*').single();
  if (error) throw error;
  const updated = await supabase.from('tasks').update({ status: 'running' }).eq('id', task.id).select('*').single();
  if (updated.error) throw updated.error;
  return { task: updated.data, time_segment: data };
}

async function pauseTask(supabase, userId, payload) {
  const task = await resolveTask(supabase, userId, payload);
  const { data: running, error: runningError } = await supabase
    .from('time_segments')
    .select('*')
    .eq('user_id', userId)
    .eq('source_type', 'task')
    .eq('source_id', task.id)
    .eq('is_running', true)
    .order('start_time', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runningError) throw runningError;
  if (!running) throw new Error('没有找到正在计时的片段。');
  const endedAt = payload.end_time ? toIso(payload.end_time, '结束时间') : new Date().toISOString();
  const updatedSegment = await supabase.from('time_segments').update({
    end_time: endedAt,
    duration_seconds: secondsBetween(running.start_time, endedAt),
    is_running: false,
  }).eq('id', running.id).select('*').single();
  if (updatedSegment.error) throw updatedSegment.error;
  await recalculateTaskDuration(supabase, task.id, { status: 'paused' });
  return { task_id: task.id, time_segment: updatedSegment.data };
}

async function completeTask(supabase, userId, payload) {
  const task = await resolveTask(supabase, userId, payload);
  const completedAt = payload.completed_at ? toIso(payload.completed_at, '完成时间') : new Date().toISOString();
  const { data: running, error: runningError } = await supabase
    .from('time_segments')
    .select('*')
    .eq('user_id', userId)
    .eq('source_type', 'task')
    .eq('source_id', task.id)
    .eq('is_running', true)
    .order('start_time', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (runningError) throw runningError;
  let timeSegment = null;
  if (running) {
    const updatedSegment = await supabase.from('time_segments').update({
      end_time: completedAt,
      duration_seconds: secondsBetween(running.start_time, completedAt),
      is_running: false,
    }).eq('id', running.id).select('*').single();
    if (updatedSegment.error) throw updatedSegment.error;
    timeSegment = updatedSegment.data;
  }
  await recalculateTaskDuration(supabase, task.id, { status: 'completed', completed_at: completedAt });
  const { data, error } = await supabase.from('tasks').select('*').eq('id', task.id).single();
  if (error) throw error;
  return { task: data, time_segment: timeSegment };
}

async function createSchedule(supabase, userId, payload) {
  const start = toIso(payload.start_time, '开始时间');
  const end = toIso(payload.end_time, '结束时间');
  if (new Date(end) <= new Date(start)) throw new Error('结束时间必须晚于开始时间。');
  const goal = await resolveGoal(supabase, userId, payload);
  const marker = markerFor(payload);
  const existing = await findByMarker(supabase, 'schedules', userId, marker);
  const note = noteWithMarker(payload.note ?? existing?.note, marker);
  const schedulePayload = {
    user_id: userId,
    title: assertString(payload.title, '日程名称'),
    goal_id: goal.goal_id,
    category: goal.category,
    start_time: start,
    end_time: end,
    is_repeat: false,
    note,
  };
  const schedule = existing
    ? await supabase.from('schedules').update(schedulePayload).eq('id', existing.id).select('*').single()
    : await supabase.from('schedules').insert(schedulePayload).select('*').single();
  if (schedule.error) throw schedule.error;

  const segmentPayload = {
    user_id: userId,
    source_type: 'schedule',
    source_id: schedule.data.id,
    goal_id: goal.goal_id,
    category: goal.category,
    title: payload.title,
    start_time: start,
    end_time: end,
    duration_seconds: secondsBetween(start, end),
    is_running: false,
    is_manual: false,
    note,
  };
  const existingSegment = await supabase
    .from('time_segments')
    .select('id')
    .eq('user_id', userId)
    .eq('source_type', 'schedule')
    .eq('source_id', schedule.data.id)
    .limit(1);
  if (existingSegment.error) throw existingSegment.error;
  const segment = existingSegment.data?.[0]
    ? await supabase.from('time_segments').update(segmentPayload).eq('id', existingSegment.data[0].id).select('*').single()
    : await supabase.from('time_segments').insert(segmentPayload).select('*').single();
  if (segment.error) throw segment.error;
  return { sync: existing ? 'updated' : 'created', schedule: schedule.data, time_segment: segment.data };
}

async function listSchedules(supabase, userId, payload = {}) {
  let query = supabase.from('schedules').select('*').eq('user_id', userId);
  if (payload.date) {
    const range = dateRangeForLocalDay(payload.date);
    query = query.lt('start_time', range.end).gt('end_time', range.start);
  } else {
    if (payload.start_time) query = query.gte('start_time', toIso(payload.start_time, '开始时间'));
    if (payload.end_time) query = query.lte('end_time', toIso(payload.end_time, '结束时间'));
  }
  const { data, error } = await query.order('start_time', { ascending: true }).limit(Math.min(Number(payload.limit || 100), 300));
  if (error) throw error;
  return data || [];
}

async function addTimeRecord(supabase, userId, payload) {
  const start = toIso(payload.start_time, '开始时间');
  const end = toIso(payload.end_time, '结束时间');
  if (new Date(end) <= new Date(start)) throw new Error('结束时间必须晚于开始时间。');
  const goal = await resolveGoal(supabase, userId, payload);
  const marker = markerFor(payload);
  const existing = await findByMarker(supabase, 'time_segments', userId, marker);
  const note = noteWithMarker(payload.note ?? existing?.note, marker);
  const recordPayload = {
    user_id: userId,
    source_type: payload.source_type || 'manual',
    source_id: payload.source_id || null,
    goal_id: goal.goal_id,
    category: goal.category,
    title: assertString(payload.title, '事项名称'),
    start_time: start,
    end_time: end,
    duration_seconds: secondsBetween(start, end),
    is_running: false,
    is_manual: true,
    note,
  };
  const { data, error } = existing
    ? await supabase.from('time_segments').update(recordPayload).eq('id', existing.id).select('*').single()
    : await supabase.from('time_segments').insert(recordPayload).select('*').single();
  if (error) throw error;
  return { sync: existing ? 'updated' : 'created', time_segment: data };
}

async function updateTimeRecord(supabase, userId, payload) {
  const segmentId = payload.segment_id || payload.time_segment_id || payload.id;
  const marker = markerFor(payload);
  let existing = null;
  if (segmentId) {
    const { data, error } = await supabase
      .from('time_segments')
      .select('*')
      .eq('user_id', userId)
      .eq('id', segmentId)
      .single();
    if (error) throw error;
    existing = data;
  } else {
    existing = await findByMarker(supabase, 'time_segments', userId, marker);
  }
  if (!existing) throw new Error('没有找到要修改的时间记录。');
  const start = payload.start_time ? toIso(payload.start_time, '开始时间') : existing.start_time;
  const end = payload.end_time ? toIso(payload.end_time, '结束时间') : existing.end_time;
  if (!end) throw new Error('正在计时的记录请先暂停后再修改。');
  if (new Date(end) <= new Date(start)) throw new Error('结束时间必须晚于开始时间。');
  const goal = await resolveGoal(supabase, userId, {
    goal_id: payload.goal_id ?? existing.goal_id,
    goal_name: payload.goal_name,
    category: payload.category ?? existing.category,
  });
  const note = marker ? noteWithMarker(payload.note ?? existing.note, marker) : (payload.note ?? existing.note ?? null);
  const { data, error } = await supabase
    .from('time_segments')
    .update({
      title: payload.title || existing.title,
      goal_id: goal.goal_id,
      category: goal.category,
      start_time: start,
      end_time: end,
      duration_seconds: secondsBetween(start, end),
      is_running: false,
      note,
    })
    .eq('user_id', userId)
    .eq('id', existing.id)
    .select('*')
    .single();
  if (error) throw error;
  if (existing.source_type === 'task' && existing.source_id) await recalculateTaskDuration(supabase, existing.source_id);
  return { time_segment: data };
}

async function listDayRecords(supabase, userId, payload = {}) {
  const range = dateRangeForLocalDay(payload.date);
  const { data, error } = await supabase
    .from('time_segments')
    .select('*')
    .eq('user_id', userId)
    .lt('start_time', range.end)
    .or(`end_time.gt.${range.start},end_time.is.null`)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function saveDailyReview(supabase, userId, payload) {
  const reviewDate = assertString(payload.review_date || payload.date, '复盘日期');
  const journal = await supabase.from('review_journals').upsert({
    user_id: userId,
    review_date: reviewDate,
    emotional_event: payload.emotional_event || null,
    emotion_feeling: payload.emotion_feeling || payload.mood_level || payload.emotion_level || null,
    thought_at_that_time: payload.thought_at_that_time || null,
    words_and_actions: payload.words_and_actions || null,
    awareness: payload.awareness || null,
    message_to_self: payload.message_to_self || null,
    next_time_action: payload.next_time_action || null,
  }, { onConflict: 'user_id,review_date' }).select('*').single();
  if (journal.error) throw journal.error;
  const review = await supabase.from('reviews').upsert({
    user_id: userId,
    review_type: 'day',
    period_start: reviewDate,
    period_end: reviewDate,
    date_range: { start: reviewDate, end: reviewDate },
    summary: payload.summary || null,
  }, { onConflict: 'user_id,review_type,period_start,period_end' }).select('*').single();
  if (review.error) throw review.error;
  return { journal: journal.data, review: review.data };
}

async function listGoals(supabase, userId) {
  const { data, error } = await supabase
    .from('goals')
    .select('id,name,category,color,status')
    .eq('user_id', userId)
    .order('created_at');
  if (error) throw error;
  return data || [];
}

async function syncBundle(supabase, userId, payload) {
  const tasks = [];
  const schedules = [];
  const timeRecords = [];
  for (const item of payload.tasks || []) tasks.push(await createTask(supabase, userId, item));
  for (const item of payload.schedules || []) schedules.push(await createSchedule(supabase, userId, item));
  for (const item of payload.time_records || payload.timeRecords || []) {
    timeRecords.push(await addTimeRecord(supabase, userId, item));
  }
  const review = payload.review ? await saveDailyReview(supabase, userId, payload.review) : null;
  return { tasks, schedules, time_records: timeRecords, review };
}

export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: '只支持 POST。' });
  try {
    const config = requireConfig();
    const providedToken = event.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
    const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: NoopWebSocket },
    });
    const access = await resolveAccess(supabase, config, providedToken);
    const userId = access.userId;
    const body = JSON.parse(event.body || '{}');
    const action = body.action || 'health';
    const payload = body.payload || {};
    const handlers = {
      health: async () => ({ ready: true, mode: access.mode, user_email: access.userEmail || null }),
      list_goals: () => listGoals(supabase, userId),
      create_goal: () => createGoal(supabase, userId, payload),
      list_tasks: () => listTasks(supabase, userId, payload),
      create_task: () => createTask(supabase, userId, payload),
      upsert_task: () => createTask(supabase, userId, payload),
      start_task: () => startTask(supabase, userId, payload),
      pause_task: () => pauseTask(supabase, userId, payload),
      complete_task: () => completeTask(supabase, userId, payload),
      list_schedules: () => listSchedules(supabase, userId, payload),
      create_schedule: () => createSchedule(supabase, userId, payload),
      upsert_schedule: () => createSchedule(supabase, userId, payload),
      list_day_records: () => listDayRecords(supabase, userId, payload),
      add_time_record: () => addTimeRecord(supabase, userId, payload),
      upsert_time_record: () => addTimeRecord(supabase, userId, payload),
      update_time_record: () => updateTimeRecord(supabase, userId, payload),
      save_daily_review: () => saveDailyReview(supabase, userId, payload),
      sync_bundle: () => syncBundle(supabase, userId, payload),
    };
    if (!handlers[action]) throw new Error(`不支持的同步动作：${action}`);
    const data = await handlers[action]();
    return json(200, { ok: true, action, data });
  } catch (error) {
    return json(400, { ok: false, error: error.message || String(error) });
  }
}
