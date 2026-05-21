#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

const CATEGORY_VALUES = new Set(['work', 'growth', 'family', 'health', 'other']);
const PRIORITY_VALUES = new Set(['high', 'medium', 'low']);

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const index = line.indexOf('=');
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(resolve(projectRoot, '.env.local'));
loadEnvFile(resolve(projectRoot, '.env.mcp.local'));

function config() {
  return {
    supabaseUrl: process.env.EFFECTIVE_TIME_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '',
    serviceRoleKey: process.env.EFFECTIVE_TIME_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    userId: process.env.EFFECTIVE_TIME_USER_ID || '',
    userEmail: process.env.EFFECTIVE_TIME_USER_EMAIL || '',
    larkCli: process.env.LARK_CLI_PATH || '/Users/fangshuai/.local/bin/lark-cli',
  };
}

function makeClient() {
  const { supabaseUrl, serviceRoleKey } = config();
  if (!supabaseUrl) throw new Error('缺少 Supabase 地址。请在 .env.mcp.local 里配置 EFFECTIVE_TIME_SUPABASE_URL。');
  if (!serviceRoleKey) {
    throw new Error('缺少数据库写入密钥。请在 .env.mcp.local 里配置 EFFECTIVE_TIME_SUPABASE_SERVICE_ROLE_KEY。');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function getUserId(supabase) {
  const { userId, userEmail } = config();
  if (userId) return userId;
  if (!userEmail) {
    throw new Error('缺少用户身份。请在 .env.mcp.local 里配置 EFFECTIVE_TIME_USER_ID，或配置 EFFECTIVE_TIME_USER_EMAIL。');
  }
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw error;
    const matched = data.users.find((user) => user.email?.toLowerCase() === userEmail.toLowerCase());
    if (matched) return matched.id;
    if (!data.users.length || data.users.length < 100) break;
  }
  throw new Error(`没有在 Supabase 用户里找到邮箱：${userEmail}`);
}

async function db() {
  const supabase = makeClient();
  const userId = await getUserId(supabase);
  return { supabase, userId };
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

function markerFor(args = {}) {
  const externalId = args.external_id || args.externalId || args.idempotency_key || null;
  if (!externalId) return null;
  const source = args.external_source || args.sync_source || args.source || 'agent';
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

function dateRangeForLocalDay(day) {
  const date = assertString(day, '日期');
  return {
    start: new Date(`${date}T00:00:00+08:00`).toISOString(),
    end: new Date(`${date}T23:59:59.999+08:00`).toISOString(),
  };
}

async function resolveGoal(supabase, userId, args = {}) {
  const goalId = args.goal_id || args.goalId || null;
  const goalName = args.goal_name || args.goalName || null;
  if (!goalId && !goalName) {
    return { goal_id: null, category: normalizeCategory(args.category) };
  }
  let query = supabase.from('goals').select('*').eq('user_id', userId);
  if (goalId) query = query.eq('id', goalId);
  const { data, error } = await query;
  if (error) throw error;
  let goal = goalId ? data[0] : null;
  if (!goal && goalName) {
    const lower = goalName.toLowerCase();
    goal = data.find((item) => item.name.toLowerCase() === lower)
      || data.find((item) => item.name.toLowerCase().includes(lower));
  }
  if (!goal) throw new Error(`没有找到目标：${goalId || goalName}`);
  return { goal_id: goal.id, category: goal.category, goal };
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

function okText(data) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  };
}

async function healthCheck() {
  const current = config();
  const status = {
    supabase_url: Boolean(current.supabaseUrl),
    service_role_key: Boolean(current.serviceRoleKey),
    user_id: Boolean(current.userId),
    user_email: current.userEmail || null,
    lark_cli_exists: existsSync(current.larkCli),
    ready: false,
  };
  if (!status.supabase_url || !status.service_role_key || (!status.user_id && !status.user_email)) {
    return {
      ...status,
      ready: false,
      next_step: '还差 Supabase service_role key 和当前用户身份，补到 .env.mcp.local 后就能写入有效时间。',
    };
  }
  const { supabase, userId } = await db();
  const { count, error } = await supabase.from('goals').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  if (error) throw error;
  return { ...status, user_id_resolved: userId, goals_count: count, ready: true };
}

async function listGoals() {
  const { supabase, userId } = await db();
  const { data, error } = await supabase.from('goals').select('*').eq('user_id', userId).order('created_at');
  if (error) throw error;
  return data || [];
}

async function createGoal(args) {
  const { supabase, userId } = await db();
  const payload = {
    user_id: userId,
    name: assertString(args.name, '目标名称'),
    category: normalizeCategory(args.category),
    description: args.description || null,
    color: args.color || '#00B7BD',
    status: args.status === 'inactive' ? 'inactive' : 'active',
  };
  const { data, error } = await supabase.from('goals').insert(payload).select('*').single();
  if (error) throw error;
  return data;
}

async function createTask(args) {
  const { supabase, userId } = await db();
  const goal = await resolveGoal(supabase, userId, args);
  const marker = markerFor(args);
  const existing = await findByMarker(supabase, 'tasks', userId, marker);
  const payload = {
    user_id: userId,
    title: assertString(args.title, '任务名称'),
    goal_id: goal.goal_id,
    category: goal.category,
    due_time: args.due_time ? toIso(args.due_time, '截止时间') : null,
    estimated_minutes: args.estimated_minutes ? Number(args.estimated_minutes) : null,
    priority: normalizePriority(args.priority),
    note: noteWithMarker(args.note ?? existing?.note, marker),
  };
  if (existing) {
    const { data, error } = await supabase.from('tasks').update(payload).eq('id', existing.id).select('*').single();
    if (error) throw error;
    return { sync: 'updated', task: data };
  }
  const { data, error } = await supabase.from('tasks').insert(payload).select('*').single();
  if (error) throw error;
  return { sync: 'created', task: data };
}

async function createSchedule(args) {
  const { supabase, userId } = await db();
  const start = toIso(args.start_time, '开始时间');
  const end = toIso(args.end_time, '结束时间');
  if (new Date(end) <= new Date(start)) throw new Error('结束时间必须晚于开始时间。');
  const goal = await resolveGoal(supabase, userId, args);
  const marker = markerFor(args);
  const existing = await findByMarker(supabase, 'schedules', userId, marker);
  const note = noteWithMarker(args.note ?? existing?.note, marker);
  const schedulePayload = {
    user_id: userId,
    title: assertString(args.title, '日程名称'),
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
    title: schedulePayload.title,
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

async function findTask(supabase, userId, args) {
  if (args.task_id || args.taskId) {
    const { data, error } = await supabase.from('tasks').select('*').eq('user_id', userId).eq('id', args.task_id || args.taskId).single();
    if (error) throw error;
    return data;
  }
  const title = assertString(args.title, '任务名称');
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
  return data[0];
}

async function startTask(args) {
  const { supabase, userId } = await db();
  const task = await findTask(supabase, userId, args);
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
  const start = args.start_time ? toIso(args.start_time, '开始时间') : new Date().toISOString();
  const goal = task.goal_id ? await resolveGoal(supabase, userId, { goal_id: task.goal_id }) : { goal_id: null, category: task.category };
  const segment = await supabase.from('time_segments').insert({
    user_id: userId,
    source_type: 'task',
    source_id: task.id,
    goal_id: task.goal_id || null,
    category: goal.category || task.category || 'other',
    title: task.title,
    start_time: start,
    duration_seconds: 0,
    is_running: true,
    is_manual: false,
    note: task.note || null,
  }).select('*').single();
  if (segment.error) throw segment.error;
  const updated = await supabase.from('tasks').update({ status: 'running' }).eq('id', task.id).select('*').single();
  if (updated.error) throw updated.error;
  return { task: updated.data, segment: segment.data };
}

async function pauseTask(args) {
  const { supabase, userId } = await db();
  const task = await findTask(supabase, userId, args);
  const { data: running, error } = await supabase
    .from('time_segments')
    .select('*')
    .eq('user_id', userId)
    .eq('source_type', 'task')
    .eq('source_id', task.id)
    .eq('is_running', true)
    .maybeSingle();
  if (error) throw error;
  if (!running) throw new Error('没有找到正在计时的片段。');
  const end = args.end_time ? toIso(args.end_time, '结束时间') : new Date().toISOString();
  const updatedSegment = await supabase
    .from('time_segments')
    .update({ end_time: end, duration_seconds: secondsBetween(running.start_time, end), is_running: false })
    .eq('id', running.id)
    .select('*')
    .single();
  if (updatedSegment.error) throw updatedSegment.error;
  await recalculateTaskDuration(supabase, task.id, { status: 'paused' });
  return updatedSegment.data;
}

async function completeTask(args) {
  const { supabase, userId } = await db();
  const task = await findTask(supabase, userId, args);
  const completedAt = args.completed_at ? toIso(args.completed_at, '完成时间') : new Date().toISOString();
  const running = await supabase
    .from('time_segments')
    .select('*')
    .eq('user_id', userId)
    .eq('source_type', 'task')
    .eq('source_id', task.id)
    .eq('is_running', true)
    .maybeSingle();
  if (running.error) throw running.error;
  if (running.data) {
    const update = await supabase
      .from('time_segments')
      .update({
        end_time: completedAt,
        duration_seconds: secondsBetween(running.data.start_time, completedAt),
        is_running: false,
      })
      .eq('id', running.data.id);
    if (update.error) throw update.error;
  }
  await recalculateTaskDuration(supabase, task.id, { status: 'completed', completed_at: completedAt });
  const { data, error } = await supabase.from('tasks').select('*').eq('id', task.id).single();
  if (error) throw error;
  return data;
}

async function addTimeRecord(args) {
  const { supabase, userId } = await db();
  const start = toIso(args.start_time, '开始时间');
  const end = toIso(args.end_time, '结束时间');
  if (new Date(end) <= new Date(start)) throw new Error('结束时间必须晚于开始时间。');
  const goal = await resolveGoal(supabase, userId, args);
  const marker = markerFor(args);
  const existing = await findByMarker(supabase, 'time_segments', userId, marker);
  const payload = {
    user_id: userId,
    source_type: args.source_type || 'manual',
    source_id: args.source_id || null,
    goal_id: goal.goal_id,
    category: goal.category,
    title: assertString(args.title, '事项名称'),
    start_time: start,
    end_time: end,
    duration_seconds: secondsBetween(start, end),
    is_running: false,
    is_manual: true,
    note: noteWithMarker(args.note ?? existing?.note, marker),
  };
  const { data, error } = existing
    ? await supabase.from('time_segments').update(payload).eq('id', existing.id).select('*').single()
    : await supabase.from('time_segments').insert(payload).select('*').single();
  if (error) throw error;
  if (payload.source_type === 'task' && payload.source_id) await recalculateTaskDuration(supabase, payload.source_id);
  return { sync: existing ? 'updated' : 'created', time_segment: data };
}

async function updateTimeRecord(args) {
  const { supabase, userId } = await db();
  const id = assertString(args.id, '时间记录 ID');
  const start = toIso(args.start_time, '开始时间');
  const end = toIso(args.end_time, '结束时间');
  if (new Date(end) <= new Date(start)) throw new Error('结束时间必须晚于开始时间。');
  const goal = await resolveGoal(supabase, userId, args);
  const { data: existing, error: getError } = await supabase.from('time_segments').select('*').eq('user_id', userId).eq('id', id).single();
  if (getError) throw getError;
  const { data, error } = await supabase
    .from('time_segments')
    .update({
      title: args.title || existing.title,
      goal_id: goal.goal_id,
      category: goal.category,
      start_time: start,
      end_time: end,
      duration_seconds: secondsBetween(start, end),
      is_running: false,
      note: args.note ?? existing.note,
    })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  if (existing.source_type === 'task' && existing.source_id) await recalculateTaskDuration(supabase, existing.source_id);
  return data;
}

async function listDayRecords(args) {
  const { supabase, userId } = await db();
  const { start, end } = dateRangeForLocalDay(args.date || new Date().toISOString().slice(0, 10));
  const { data, error } = await supabase
    .from('time_segments')
    .select('*')
    .eq('user_id', userId)
    .lte('start_time', end)
    .or(`end_time.gte.${start},end_time.is.null`)
    .order('start_time', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function listSchedules(args) {
  const { supabase, userId } = await db();
  let query = supabase.from('schedules').select('*').eq('user_id', userId);
  if (args.date) {
    const { start, end } = dateRangeForLocalDay(args.date);
    query = query.lte('start_time', end).gte('end_time', start);
  } else {
    if (args.start_time) query = query.gte('end_time', toIso(args.start_time, '开始范围'));
    if (args.end_time) query = query.lte('start_time', toIso(args.end_time, '结束范围'));
  }
  const { data, error } = await query.order('start_time', { ascending: true });
  if (error) throw error;
  return data || [];
}

async function saveDailyReview(args) {
  const { supabase, userId } = await db();
  const reviewDate = assertString(args.review_date || args.date, '复盘日期');
  const journalPayload = {
    user_id: userId,
    review_date: reviewDate,
    emotional_event: args.emotional_event || null,
    emotion_feeling: args.emotion_feeling || args.mood_level || args.emotion_level || null,
    thought_at_that_time: args.thought_at_that_time || null,
    words_and_actions: args.words_and_actions || null,
    awareness: args.awareness || null,
    message_to_self: args.message_to_self || null,
    next_time_action: args.next_time_action || null,
  };
  const journal = await supabase.from('review_journals').upsert(journalPayload, { onConflict: 'user_id,review_date' }).select('*').single();
  if (journal.error) throw journal.error;
  const review = await supabase.from('reviews').upsert({
    user_id: userId,
    review_type: 'day',
    period_start: reviewDate,
    period_end: reviewDate,
    date_range: { start: reviewDate, end: reviewDate },
    summary: args.summary || null,
  }, { onConflict: 'user_id,review_type,period_start,period_end' }).select('*').single();
  if (review.error) throw review.error;
  return { journal: journal.data, review: review.data };
}

async function runLarkTaskList(args = {}) {
  const { larkCli } = config();
  if (!existsSync(larkCli)) throw new Error('没有找到飞书命令工具。');
  const cliArgs = ['task', '+get-my-tasks', '--as', 'user', '--format', 'json'];
  if (args.complete !== undefined) cliArgs.push(`--complete=${Boolean(args.complete)}`);
  if (args.query) cliArgs.push('--query', String(args.query));
  if (args.created_at) cliArgs.push('--created_at', String(args.created_at));
  if (args.due_start) cliArgs.push('--due-start', String(args.due_start));
  if (args.due_end) cliArgs.push('--due-end', String(args.due_end));
  const limit = Math.min(Number(args.limit || args.page_limit || 20), 40);
  cliArgs.push('--page-limit', String(limit));
  const { stdout } = await execFileAsync(larkCli, cliArgs, { maxBuffer: 1024 * 1024 * 10 });
  const parsed = JSON.parse(stdout);
  if (!parsed.ok) throw new Error(parsed.error?.message || '读取飞书任务失败');
  return {
    items: (parsed.data?.items || []).slice(0, limit),
    notice: parsed._notice || null,
  };
}

async function listFeishuTasks(args) {
  return runLarkTaskList(args);
}

function normalizeLarkEvent(event) {
  const title = event.summary || event.title || event.subject || event.name || '飞书日程';
  const startRaw = event.start_time || event.start_at || event.startTime || event.start?.date_time || event.start?.timestamp || event.start;
  const endRaw = event.end_time || event.end_at || event.endTime || event.end?.date_time || event.end?.timestamp || event.end;
  const start = typeof startRaw === 'number' ? new Date(startRaw * (startRaw > 100000000000 ? 1 : 1000)) : new Date(startRaw);
  const end = typeof endRaw === 'number' ? new Date(endRaw * (endRaw > 100000000000 ? 1 : 1000)) : new Date(endRaw);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  return {
    title,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    event_id: event.event_id || event.id || event.eventId || event.uid || null,
    url: event.url || event.app_link || event.applink || null,
    raw: event,
  };
}

async function runLarkAgenda(args = {}) {
  const { larkCli } = config();
  if (!existsSync(larkCli)) throw new Error('没有找到飞书命令工具。');
  const date = args.date || null;
  const range = date ? dateRangeForLocalDay(date) : null;
  const start = args.start_time || args.start || range?.start || new Date().toISOString();
  const end = args.end_time || args.end || range?.end || new Date(new Date(start).getTime() + 24 * 60 * 60 * 1000).toISOString();
  const cliArgs = [
    'calendar',
    '+agenda',
    '--as',
    'user',
    '--format',
    'json',
    '--start',
    start,
    '--end',
    end,
  ];
  if (args.calendar_id) cliArgs.push('--calendar-id', String(args.calendar_id));
  const { stdout } = await execFileAsync(larkCli, cliArgs, { maxBuffer: 1024 * 1024 * 10 });
  const parsed = JSON.parse(stdout);
  if (!parsed.ok) throw new Error(parsed.error?.message || '读取飞书日程失败');
  const rawItems = Array.isArray(parsed.data) ? parsed.data : parsed.data?.items || [];
  const events = rawItems.map(normalizeLarkEvent).filter(Boolean);
  return { events, raw_items: rawItems, notice: parsed._notice || null };
}

async function listFeishuCalendar(args) {
  return runLarkAgenda(args);
}

async function importFeishuCalendarAsSchedules(args) {
  const { supabase, userId } = await db();
  const { events, notice } = await runLarkAgenda(args);
  const goal = await resolveGoal(supabase, userId, args);
  const imported = [];
  const skipped = [];
  for (const event of events) {
    const marker = event.event_id ? `feishu_event_id:${event.event_id}` : `feishu_event_time:${event.start_time}`;
    const duplicate = await supabase
      .from('schedules')
      .select('id,title')
      .eq('user_id', userId)
      .ilike('note', `%${marker}%`)
      .maybeSingle();
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) {
      skipped.push({ title: event.title, reason: '已存在', marker });
      continue;
    }
    const created = await createSchedule({
      title: event.title,
      start_time: event.start_time,
      end_time: event.end_time,
      goal_id: goal.goal_id,
      category: goal.category,
      note: ['来自飞书日程', marker, event.url].filter(Boolean).join('\n'),
    });
    imported.push(created);
  }
  return { imported_count: imported.length, skipped_count: skipped.length, imported, skipped, notice };
}

async function importFeishuTasksAsTasks(args) {
  const { supabase, userId } = await db();
  const { items, notice } = await runLarkTaskList(args);
  const goal = await resolveGoal(supabase, userId, args);
  const imported = [];
  const skipped = [];
  for (const item of items) {
    const duplicate = await supabase
      .from('tasks')
      .select('id,title')
      .eq('user_id', userId)
      .ilike('note', `%feishu_guid:${item.guid}%`)
      .maybeSingle();
    if (duplicate.error) throw duplicate.error;
    if (duplicate.data) {
      skipped.push({ guid: item.guid, title: item.summary, reason: '已存在' });
      continue;
    }
    const payload = {
      user_id: userId,
      title: item.summary,
      goal_id: goal.goal_id,
      category: goal.category,
      due_time: item.due_at ? new Date(item.due_at).toISOString() : null,
      priority: normalizePriority(args.priority),
      status: 'not_started',
      note: ['来自飞书任务', `feishu_guid:${item.guid}`, item.url].filter(Boolean).join('\n'),
    };
    const { data, error } = await supabase.from('tasks').insert(payload).select('*').single();
    if (error) throw error;
    imported.push(data);
  }
  return { imported_count: imported.length, skipped_count: skipped.length, imported, skipped, notice };
}

async function recordFeishuTaskTime(args) {
  const guid = args.guid || null;
  let item = null;
  if (guid) {
    const { items } = await runLarkTaskList({ complete: args.complete, limit: 40 });
    item = items.find((task) => task.guid === guid);
  }
  if (!item && args.query) {
    const { items } = await runLarkTaskList({ query: args.query, complete: args.complete, limit: 10 });
    item = items.find((task) => task.summary === args.query) || items[0];
  }
  if (!item) throw new Error('没有找到匹配的飞书任务。请提供 guid 或更明确的 query。');
  return addTimeRecord({
    ...args,
    title: args.title || item.summary,
    source_type: 'manual',
    note: [args.note, '来自飞书任务', `feishu_guid:${item.guid}`, item.url].filter(Boolean).join('\n'),
  });
}

const tools = {
  health_check: {
    description: '检查“有效时间 MCP”是否已经能连接数据库和飞书。',
    inputSchema: { type: 'object', properties: {} },
    handler: healthCheck,
  },
  list_goals: {
    description: '查看当前用户在“有效时间”里的目标。',
    inputSchema: { type: 'object', properties: {} },
    handler: listGoals,
  },
  create_goal: {
    description: '创建一个目标。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        category: { type: 'string', enum: [...CATEGORY_VALUES] },
        description: { type: 'string' },
        color: { type: 'string' },
        status: { type: 'string', enum: ['active', 'inactive'] },
      },
      required: ['name', 'category'],
    },
    handler: createGoal,
  },
  create_task: {
    description: '在“有效时间”里创建任务。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        goal_id: { type: 'string' },
        goal_name: { type: 'string' },
        category: { type: 'string', enum: [...CATEGORY_VALUES] },
        due_time: { type: 'string' },
        estimated_minutes: { type: 'number' },
        priority: { type: 'string', enum: [...PRIORITY_VALUES] },
        note: { type: 'string' },
        external_source: { type: 'string' },
        external_id: { type: 'string' },
      },
      required: ['title'],
    },
    handler: createTask,
  },
  create_schedule: {
    description: '在“有效时间”里创建单次日程，并自动进入时间轴。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start_time: { type: 'string' },
        end_time: { type: 'string' },
        goal_id: { type: 'string' },
        goal_name: { type: 'string' },
        category: { type: 'string', enum: [...CATEGORY_VALUES] },
        note: { type: 'string' },
        external_source: { type: 'string' },
        external_id: { type: 'string' },
      },
      required: ['title', 'start_time', 'end_time'],
    },
    handler: createSchedule,
  },
  start_task: {
    description: '开始任务计时，可按任务 ID 或标题查找。',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, title: { type: 'string' }, start_time: { type: 'string' } },
    },
    handler: startTask,
  },
  pause_task: {
    description: '暂停任务计时。',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, title: { type: 'string' }, end_time: { type: 'string' } },
    },
    handler: pauseTask,
  },
  complete_task: {
    description: '完成任务，并自动结束正在运行的计时片段。',
    inputSchema: {
      type: 'object',
      properties: { task_id: { type: 'string' }, title: { type: 'string' }, completed_at: { type: 'string' } },
    },
    handler: completeTask,
  },
  add_time_record: {
    description: '补录一条真实时间记录。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        start_time: { type: 'string' },
        end_time: { type: 'string' },
        goal_id: { type: 'string' },
        goal_name: { type: 'string' },
        category: { type: 'string', enum: [...CATEGORY_VALUES] },
        source_type: { type: 'string', enum: ['manual', 'task', 'schedule'] },
        source_id: { type: 'string' },
        note: { type: 'string' },
        external_source: { type: 'string' },
        external_id: { type: 'string' },
      },
      required: ['title', 'start_time', 'end_time'],
    },
    handler: addTimeRecord,
  },
  update_time_record: {
    description: '修改一条已有时间记录。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        start_time: { type: 'string' },
        end_time: { type: 'string' },
        goal_id: { type: 'string' },
        goal_name: { type: 'string' },
        category: { type: 'string', enum: [...CATEGORY_VALUES] },
        note: { type: 'string' },
      },
      required: ['id', 'start_time', 'end_time'],
    },
    handler: updateTimeRecord,
  },
  list_day_records: {
    description: '查看某一天的时间记录。',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
    },
    handler: listDayRecords,
  },
  list_schedules: {
    description: '查看“有效时间”里的日程。',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        start_time: { type: 'string' },
        end_time: { type: 'string' },
      },
    },
    handler: listSchedules,
  },
  save_daily_review: {
    description: '保存某一天的每日复盘和觉醒日记。',
    inputSchema: {
      type: 'object',
      properties: {
        review_date: { type: 'string' },
        mood_level: { type: 'string' },
        emotional_event: { type: 'string' },
        emotion_feeling: { type: 'string' },
        thought_at_that_time: { type: 'string' },
        words_and_actions: { type: 'string' },
        awareness: { type: 'string' },
        message_to_self: { type: 'string' },
        next_time_action: { type: 'string' },
        summary: { type: 'string' },
      },
      required: ['review_date'],
    },
    handler: saveDailyReview,
  },
  list_feishu_tasks: {
    description: '读取飞书里分配给当前用户的任务，供整理后导入“有效时间”。',
    inputSchema: {
      type: 'object',
      properties: {
        complete: { type: 'boolean' },
        query: { type: 'string' },
        created_at: { type: 'string' },
        due_start: { type: 'string' },
        due_end: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    handler: listFeishuTasks,
  },
  list_feishu_calendar: {
    description: '读取飞书日历日程，供整理后同步到“有效时间”。',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        start_time: { type: 'string' },
        end_time: { type: 'string' },
        calendar_id: { type: 'string' },
      },
    },
    handler: listFeishuCalendar,
  },
  import_feishu_calendar_as_schedules: {
    description: '把飞书日历日程导入为“有效时间”的日程，并自动进入时间轴。',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'YYYY-MM-DD' },
        start_time: { type: 'string' },
        end_time: { type: 'string' },
        calendar_id: { type: 'string' },
        goal_id: { type: 'string' },
        goal_name: { type: 'string' },
        category: { type: 'string', enum: [...CATEGORY_VALUES] },
      },
    },
    handler: importFeishuCalendarAsSchedules,
  },
  import_feishu_tasks_as_tasks: {
    description: '把飞书任务导入为“有效时间”的任务，自动跳过已导入的飞书任务。',
    inputSchema: {
      type: 'object',
      properties: {
        complete: { type: 'boolean' },
        query: { type: 'string' },
        created_at: { type: 'string' },
        due_start: { type: 'string' },
        due_end: { type: 'string' },
        limit: { type: 'number' },
        goal_id: { type: 'string' },
        goal_name: { type: 'string' },
        category: { type: 'string', enum: [...CATEGORY_VALUES] },
        priority: { type: 'string', enum: [...PRIORITY_VALUES] },
      },
    },
    handler: importFeishuTasksAsTasks,
  },
  record_feishu_task_time: {
    description: '把某个飞书任务记录成“有效时间”的一条真实时间记录。',
    inputSchema: {
      type: 'object',
      properties: {
        guid: { type: 'string' },
        query: { type: 'string' },
        start_time: { type: 'string' },
        end_time: { type: 'string' },
        goal_id: { type: 'string' },
        goal_name: { type: 'string' },
        category: { type: 'string', enum: [...CATEGORY_VALUES] },
        note: { type: 'string' },
      },
      required: ['start_time', 'end_time'],
    },
    handler: recordFeishuTaskTime,
  },
};

async function handle(message) {
  if (message.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'effective-time', version: '0.1.0' },
      },
    };
  }
  if (message.method === 'ping') return { jsonrpc: '2.0', id: message.id, result: {} };
  if (message.method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: Object.entries(tools).map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      },
    };
  }
  if (message.method === 'tools/call') {
    const name = message.params?.name;
    const tool = tools[name];
    if (!tool) throw new Error(`未知工具：${name}`);
    const result = await tool.handler(message.params?.arguments || {});
    return { jsonrpc: '2.0', id: message.id, result: okText(result) };
  }
  if (message.method?.startsWith('notifications/')) return null;
  return { jsonrpc: '2.0', id: message.id, result: {} };
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

rl.on('line', async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
    const response = await handle(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    const id = message?.id ?? null;
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: error.message || String(error) },
    }) + '\n');
  }
});
