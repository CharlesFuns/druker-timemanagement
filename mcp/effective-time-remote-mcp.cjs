#!/usr/bin/env node
const readline = require('node:readline');

const API_URL = process.env.EFFECTIVE_TIME_API_URL || 'https://drukertime.top/api/agent-sync';
const AGENT_TOKEN = process.env.EFFECTIVE_TIME_AGENT_TOKEN || process.env.AGENT_SYNC_TOKEN || '';

const CATEGORY_VALUES = ['work', 'growth', 'family', 'health', 'other'];
const PRIORITY_VALUES = ['high', 'medium', 'low'];
const TASK_STATUS = ['not_started', 'running', 'paused', 'completed'];

function okText(data) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  };
}

async function callApi(action, payload = {}) {
  if (!AGENT_TOKEN) throw new Error('缺少 EFFECTIVE_TIME_AGENT_TOKEN，请先在“有效时间”的 Agent 接入页生成个人口令。');
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${AGENT_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ action, payload }),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(text || `请求失败：${response.status}`);
  }
  if (!response.ok || !body.ok) throw new Error(body.error || `请求失败：${response.status}`);
  return body.data;
}

const schemas = {
  empty: { type: 'object', properties: {} },
  goal: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      category: { type: 'string', enum: CATEGORY_VALUES },
      description: { type: 'string' },
      color: { type: 'string' },
      status: { type: 'string', enum: ['active', 'inactive'] },
    },
    required: ['name', 'category'],
  },
  task: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      goal_id: { type: 'string' },
      goal_name: { type: 'string' },
      category: { type: 'string', enum: CATEGORY_VALUES },
      due_time: { type: 'string' },
      estimated_minutes: { type: 'number' },
      priority: { type: 'string', enum: PRIORITY_VALUES },
      note: { type: 'string' },
      external_source: { type: 'string' },
      external_id: { type: 'string' },
    },
    required: ['title'],
  },
  taskSelector: {
    type: 'object',
    properties: {
      task_id: { type: 'string' },
      title: { type: 'string' },
      query: { type: 'string' },
      start_time: { type: 'string' },
      end_time: { type: 'string' },
      completed_at: { type: 'string' },
    },
  },
  schedule: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      goal_id: { type: 'string' },
      goal_name: { type: 'string' },
      category: { type: 'string', enum: CATEGORY_VALUES },
      start_time: { type: 'string' },
      end_time: { type: 'string' },
      note: { type: 'string' },
      external_source: { type: 'string' },
      external_id: { type: 'string' },
    },
    required: ['title', 'start_time', 'end_time'],
  },
  timeRecord: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      source_type: { type: 'string', enum: ['task', 'schedule', 'manual'] },
      source_id: { type: 'string' },
      goal_id: { type: 'string' },
      goal_name: { type: 'string' },
      category: { type: 'string', enum: CATEGORY_VALUES },
      start_time: { type: 'string' },
      end_time: { type: 'string' },
      note: { type: 'string' },
      external_source: { type: 'string' },
      external_id: { type: 'string' },
    },
    required: ['title', 'start_time', 'end_time'],
  },
  updateTimeRecord: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      segment_id: { type: 'string' },
      title: { type: 'string' },
      goal_id: { type: 'string' },
      goal_name: { type: 'string' },
      category: { type: 'string', enum: CATEGORY_VALUES },
      start_time: { type: 'string' },
      end_time: { type: 'string' },
      note: { type: 'string' },
      external_source: { type: 'string' },
      external_id: { type: 'string' },
    },
  },
  day: {
    type: 'object',
    properties: { date: { type: 'string', description: 'YYYY-MM-DD' } },
    required: ['date'],
  },
  listTasks: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: TASK_STATUS },
      query: { type: 'string' },
      due_start: { type: 'string' },
      due_end: { type: 'string' },
      limit: { type: 'number' },
    },
  },
  listSchedules: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'YYYY-MM-DD' },
      start_time: { type: 'string' },
      end_time: { type: 'string' },
      limit: { type: 'number' },
    },
  },
  review: {
    type: 'object',
    properties: {
      review_date: { type: 'string', description: 'YYYY-MM-DD' },
      mood_level: { type: 'string' },
      emotion_level: { type: 'string' },
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
};

const tools = {
  health_check: { description: '检查有效时间 Agent 接入是否可用。', inputSchema: schemas.empty, action: 'health' },
  list_goals: { description: '查看我的有效时间目标。', inputSchema: schemas.empty, action: 'list_goals' },
  create_goal: { description: '创建一个有效时间目标。', inputSchema: schemas.goal, action: 'create_goal' },
  list_tasks: { description: '查看我的有效时间任务。', inputSchema: schemas.listTasks, action: 'list_tasks' },
  create_task: { description: '创建一个有效时间任务。', inputSchema: schemas.task, action: 'create_task' },
  start_task: { description: '开始执行一个任务并计时。可用 task_id 或 title 指定任务。', inputSchema: schemas.taskSelector, action: 'start_task' },
  pause_task: { description: '暂停一个正在计时的任务。可用 task_id 或 title 指定任务。', inputSchema: schemas.taskSelector, action: 'pause_task' },
  complete_task: { description: '完成一个任务；如果正在计时，会自动结束当前时间片段。', inputSchema: schemas.taskSelector, action: 'complete_task' },
  list_schedules: { description: '查看我的有效时间日程。', inputSchema: schemas.listSchedules, action: 'list_schedules' },
  create_schedule: { description: '创建一个日程，并同步进入时间轴。', inputSchema: schemas.schedule, action: 'create_schedule' },
  list_day_records: { description: '查看某一天的时间记录。', inputSchema: schemas.day, action: 'list_day_records' },
  add_time_record: { description: '补录一条真实时间记录。', inputSchema: schemas.timeRecord, action: 'add_time_record' },
  update_time_record: { description: '修改一条已有时间记录。', inputSchema: schemas.updateTimeRecord, action: 'update_time_record' },
  save_daily_review: { description: '保存某一天的每日复盘和觉醒日记。', inputSchema: schemas.review, action: 'save_daily_review' },
};

async function handle(message) {
  if (message.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'effective-time-remote', version: '0.2.0' },
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
    const name = message.params && message.params.name;
    const tool = tools[name];
    if (!tool) throw new Error(`未知工具：${name}`);
    const data = await callApi(tool.action, (message.params && message.params.arguments) || {});
    return { jsonrpc: '2.0', id: message.id, result: okText(data) };
  }
  if (message.method && message.method.startsWith('notifications/')) return null;
  return { jsonrpc: '2.0', id: message.id, result: {} };
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
    const response = await handle(message);
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: message && message.id !== undefined ? message.id : null,
      error: { code: -32000, message: error.message || String(error) },
    }) + '\n');
  }
});
