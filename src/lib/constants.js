export const CATEGORY_OPTIONS = [
  { value: 'work', label: '工作', description: '职业、业务、项目、岗位贡献', color: '#00B7BD' },
  { value: 'growth', label: '学习成长', description: '学习、认知提升、技能成长', color: '#1677FF' },
  { value: 'family', label: '家庭社交', description: '家庭、朋友、人际关系', color: '#5FE0B7' },
  { value: 'health', label: '健康', description: '运动、睡眠、饮食、身体状态', color: '#FC873B' },
  { value: 'other', label: '其他', description: '未绑定目标的事项', color: '#A7A7A7' },
];

export const PRIORITY_OPTIONS = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
];

export const TASK_STATUS = {
  not_started: '未开始',
  running: '执行中',
  paused: '已暂停',
  completed: '已完成',
};

export const DEFAULT_GOALS = [
  {
    name: '工作主线',
    category: 'work',
    description: '把时间投入到真正产生贡献的工作上。',
    color: '#00B7BD',
  },
  {
    name: '学习成长',
    category: 'growth',
    description: '持续阅读、练习和升级认知。',
    color: '#1677FF',
  },
  {
    name: '高质量陪伴',
    category: 'family',
    description: '把关系放进真实的日程和时间里。',
    color: '#5FE0B7',
  },
  {
    name: '身体秩序',
    category: 'health',
    description: '用运动、睡眠和饮食支撑长期有效性。',
    color: '#FC873B',
  },
];

export const JOURNAL_FIELDS = [
  { key: 'emotional_event', label: '今天哪件事情让我的情绪波动最大？' },
  { key: 'emotion_feeling', label: '我的情绪感受是？' },
  { key: 'thought_at_that_time', label: '我当时的想法是？' },
  { key: 'words_and_actions', label: '我当时说了什么，做了什么？' },
  { key: 'awareness', label: '我的觉察是？' },
  { key: 'message_to_self', label: '我准备对当时的自己说什么？' },
  { key: 'next_time_action', label: '如果再来一次，我会怎么做？' },
];

export const EMOTION_LEVELS = [
  { value: 'laugh', label: '大笑', icon: '😆', score: 5, color: '#00B7BD' },
  { value: 'happy', label: '开心', icon: '😊', score: 4, color: '#05C3DD' },
  { value: 'normal', label: '一般', icon: '😐', score: 3, color: '#1677FF' },
  { value: 'down', label: '沮丧', icon: '😞', score: 2, color: '#FC873B' },
  { value: 'sick', label: '恶心到想吐', icon: '🤢', score: 1, color: '#8C8C8C' },
];

export const BRAND_COLORS = ['#00B7BD', '#05C3DD', '#5FE0B7', '#1677FF', '#00024A', '#FC873B'];
