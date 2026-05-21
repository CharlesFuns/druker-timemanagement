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
  if (!supabaseUrl || !serviceRoleKey || !token || (!userId && !userEmail)) {
    throw new Error('同步入口还没有完成环境配置。');
  }
  return { supabaseUrl, serviceRoleKey, token, userId, userEmail };
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
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const matched = data.users.find((user) => user.email?.toLowerCase() === config.userEmail.toLowerCase());
    if (matched) return matched.id;
    if (!data.users.length || data.users.length < 100) break;
  }
  throw new Error(`没有找到用户：${config.userEmail}`);
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

async function saveDailyReview(supabase, userId, payload) {
  const reviewDate = assertString(payload.review_date || payload.date, '复盘日期');
  const journal = await supabase.from('review_journals').upsert({
    user_id: userId,
    review_date: reviewDate,
    emotional_event: payload.emotional_event || null,
    emotion_feeling: payload.emotion_feeling || payload.mood_level || null,
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
    if (!providedToken || providedToken !== config.token) return json(401, { ok: false, error: '同步口令不正确。' });
    const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: NoopWebSocket },
    });
    const userId = await resolveUserId(supabase, config);
    const body = JSON.parse(event.body || '{}');
    const action = body.action || 'health';
    const payload = body.payload || {};
    const handlers = {
      health: async () => ({ ready: true, user_id: userId }),
      list_goals: () => listGoals(supabase, userId),
      create_task: () => createTask(supabase, userId, payload),
      upsert_task: () => createTask(supabase, userId, payload),
      create_schedule: () => createSchedule(supabase, userId, payload),
      upsert_schedule: () => createSchedule(supabase, userId, payload),
      add_time_record: () => addTimeRecord(supabase, userId, payload),
      upsert_time_record: () => addTimeRecord(supabase, userId, payload),
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
