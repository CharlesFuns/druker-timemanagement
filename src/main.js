import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { hasSupabaseConfig, getMissingConfigMessage, supabase } from './lib/supabase.js';
import {
  BRAND_COLORS,
  CATEGORY_OPTIONS,
  DEFAULT_GOALS,
  EMOTION_LEVELS,
  JOURNAL_FIELDS,
  PRIORITY_OPTIONS,
  TASK_STATUS,
} from './lib/constants.js';
import {
  assignTimelineLanes,
  buildDistribution,
  conicGradient,
  dateKey,
  focusBuckets,
  formatClock,
  formatDuration,
  fromDateTimeLocal,
  getSegmentDuration,
  isSameLocalDate,
  secondsBetween,
  segmentsForDate,
  sumDurations,
  toDateTimeLocal,
  unionDurationSeconds,
} from './lib/time.js';
import './styles.css';

const h = React.createElement;

const VIEWS = [
  { key: 'today', label: '今日', eyebrow: 'Today' },
  { key: 'goals', label: '目标', eyebrow: 'Goals' },
  { key: 'tasks', label: '任务', eyebrow: 'Tasks' },
  { key: 'schedules', label: '日程', eyebrow: 'Calendar' },
  { key: 'timeline', label: '时间轴', eyebrow: 'Timeline' },
  { key: 'dashboard', label: '日看板', eyebrow: 'Insight' },
  { key: 'review', label: '每日复盘', eyebrow: 'Awake' },
  { key: 'agent', label: 'Agent 接入', eyebrow: 'MCP' },
];

const EMPTY_DATA = {
  goals: [],
  tasks: [],
  schedules: [],
  segments: [],
  journals: [],
  reviews: [],
};

function classNames(...items) {
  return items.filter(Boolean).join(' ');
}

function throwIfError(result) {
  if (result.error) throw result.error;
  return result.data;
}

function categoryMeta(value) {
  return CATEGORY_OPTIONS.find((item) => item.value === value) || CATEGORY_OPTIONS[CATEGORY_OPTIONS.length - 1];
}

function addMinutes(date, minutes) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function toLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date) {
  const next = toLocalDay(date);
  const mondayOffset = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - mondayOffset);
  return next;
}

function daysBetween(start, end) {
  return Math.floor((toLocalDay(end) - toLocalDay(start)) / 86400000);
}

function withTimeFrom(day, template) {
  const next = toLocalDay(day);
  next.setHours(template.getHours(), template.getMinutes(), 0, 0);
  return next;
}

function nthWeekdayOfMonth(year, month, weekday, nth) {
  if (nth === 'last') {
    const day = new Date(year, month + 1, 0);
    while (day.getDay() !== weekday) day.setDate(day.getDate() - 1);
    return day;
  }
  const first = new Date(year, month, 1);
  const offset = (weekday - first.getDay() + 7) % 7;
  const day = new Date(year, month, 1 + offset + (Number(nth) - 1) * 7);
  return day.getMonth() === month ? day : null;
}

function endOfWeek(date) {
  const next = startOfWeek(date);
  next.setDate(next.getDate() + 6);
  return next;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0);
}

function addDays(date, days) {
  const next = toLocalDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

function scheduleOverlapsDay(schedule, day) {
  const dayStart = toLocalDay(day);
  const dayEnd = addDays(dayStart, 1);
  const start = new Date(schedule.start_time);
  const end = new Date(schedule.end_time);
  return start < dayEnd && end > dayStart;
}

function schedulesForDay(schedules, day) {
  return schedules
    .filter((schedule) => scheduleOverlapsDay(schedule, day))
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
}

function formatMonthTitle(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function formatShortDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatScheduleRange(schedule) {
  const start = new Date(schedule.start_time);
  const end = new Date(schedule.end_time);
  const sameDay = dateKey(start) === dateKey(end);
  return sameDay
    ? `${formatClock(start)} - ${formatClock(end)}`
    : `${formatShortDate(start)} ${formatClock(start)} - ${formatShortDate(end)} ${formatClock(end)}`;
}

const CHINA_2026_DAY_LABELS = {
  '2026-01-01': { holiday: '元旦' },
  '2026-01-02': { holiday: '元旦' },
  '2026-01-03': { holiday: '元旦' },
  '2026-01-04': { workday: '补班' },
  '2026-02-14': { workday: '补班' },
  '2026-02-15': { holiday: '春节' },
  '2026-02-16': { holiday: '春节' },
  '2026-02-17': { holiday: '春节' },
  '2026-02-18': { holiday: '春节' },
  '2026-02-19': { holiday: '春节' },
  '2026-02-20': { holiday: '春节' },
  '2026-02-21': { holiday: '春节' },
  '2026-02-22': { holiday: '春节' },
  '2026-02-23': { holiday: '春节' },
  '2026-02-28': { workday: '补班' },
  '2026-04-04': { holiday: '清明' },
  '2026-04-05': { holiday: '清明' },
  '2026-04-06': { holiday: '清明' },
  '2026-05-01': { holiday: '劳动节' },
  '2026-05-02': { holiday: '劳动节' },
  '2026-05-03': { holiday: '劳动节' },
  '2026-05-04': { holiday: '劳动节' },
  '2026-05-05': { holiday: '劳动节' },
  '2026-05-09': { workday: '补班' },
  '2026-06-19': { holiday: '端午' },
  '2026-06-20': { holiday: '端午' },
  '2026-06-21': { holiday: '端午' },
  '2026-09-20': { workday: '补班' },
  '2026-09-25': { holiday: '中秋' },
  '2026-09-26': { holiday: '中秋' },
  '2026-09-27': { holiday: '中秋' },
  '2026-10-01': { holiday: '国庆' },
  '2026-10-02': { holiday: '国庆' },
  '2026-10-03': { holiday: '国庆' },
  '2026-10-04': { holiday: '国庆' },
  '2026-10-05': { holiday: '国庆' },
  '2026-10-06': { holiday: '国庆' },
  '2026-10-07': { holiday: '国庆' },
  '2026-10-10': { workday: '补班' },
};

const SOLAR_TERMS_2026 = {
  '2026-01-05': '小寒',
  '2026-01-20': '大寒',
  '2026-02-04': '立春',
  '2026-02-19': '雨水',
  '2026-03-05': '惊蛰',
  '2026-03-20': '春分',
  '2026-04-05': '清明',
  '2026-04-20': '谷雨',
  '2026-05-05': '立夏',
  '2026-05-21': '小满',
  '2026-06-05': '芒种',
  '2026-06-21': '夏至',
  '2026-07-07': '小暑',
  '2026-07-23': '大暑',
  '2026-08-07': '立秋',
  '2026-08-23': '处暑',
  '2026-09-07': '白露',
  '2026-09-23': '秋分',
  '2026-10-08': '寒露',
  '2026-10-23': '霜降',
  '2026-11-07': '立冬',
  '2026-11-22': '小雪',
  '2026-12-07': '大雪',
  '2026-12-21': '冬至',
};

const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', {
  month: 'long',
  day: 'numeric',
});

function formatLunarDate(date) {
  return lunarFormatter
    .format(date)
    .replace('十一月', '冬月')
    .replace('十二月', '腊月');
}

function getDateMeta(date) {
  const key = dateKey(date);
  const dayLabel = CHINA_2026_DAY_LABELS[key] || {};
  const solarTerm = SOLAR_TERMS_2026[key];
  return {
    lunar: formatLunarDate(date),
    holiday: dayLabel.holiday,
    workday: dayLabel.workday,
    solarTerm,
  };
}

function roundToNextQuarter(date = new Date()) {
  const next = new Date(date);
  const minutes = next.getMinutes();
  next.setMinutes(Math.ceil(minutes / 15) * 15, 0, 0);
  return next;
}

function getGoalCategory(goalId, goalsById) {
  const goal = goalId ? goalsById.get(goalId) : null;
  return goal?.category || 'other';
}

function getGoalColor(goalId, goalsById) {
  const goal = goalId ? goalsById.get(goalId) : null;
  return goal?.color || categoryMeta('other').color;
}

function getGoalLabel(goalId, goalsById) {
  const goal = goalId ? goalsById.get(goalId) : null;
  return goal?.name || '其他事项';
}

function getSourceLabel(sourceType) {
  if (sourceType === 'task') return '任务';
  if (sourceType === 'schedule') return '日程';
  return '临时事项';
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 0, label: '周日' },
];

const CALENDAR_HOUR_HEIGHT = 72;
const CALENDAR_SNAP_MINUTES = 15;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundToSnap(minutes) {
  return clamp(Math.round(minutes / CALENDAR_SNAP_MINUTES) * CALENDAR_SNAP_MINUTES, 0, 1439);
}

function minutesOfDay(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function scheduleLayoutForDay(schedules, day) {
  const dayStart = toLocalDay(day);
  const dayEnd = addDays(dayStart, 1);
  const lanes = [];
  const items = schedulesForDay(schedules, day).map((schedule) => {
    const start = new Date(schedule.start_time);
    const end = new Date(schedule.end_time);
    const clampedStart = start < dayStart ? dayStart : start;
    const clampedEnd = end > dayEnd ? dayEnd : end;
    const startMinute = minutesOfDay(clampedStart);
    const rawEndMinute = clampedEnd.getTime() === dayEnd.getTime() ? 1440 : minutesOfDay(clampedEnd);
    const endMinute = Math.max(startMinute + 15, rawEndMinute);
    return { schedule, startMinute, endMinute };
  });

  const assigned = items.map((item) => {
    const laneIndex = lanes.findIndex((laneEnd) => laneEnd <= item.startMinute);
    const lane = laneIndex === -1 ? lanes.length : laneIndex;
    lanes[lane] = item.endMinute;
    return { ...item, lane, laneCount: 1 };
  });
  return assigned.map((item) => ({ ...item, laneCount: Math.max(1, lanes.length) }));
}

function buildRepeatSummary(form, count) {
  if (form.repeat_type === 'weekly') {
    const labels = WEEKDAY_OPTIONS.filter((item) => form.repeat_weekdays.includes(String(item.value))).map((item) => item.label);
    return `每 ${form.repeat_interval} 周 · ${labels.join('、')} · 共 ${count} 次`;
  }
  if (form.repeat_type === 'monthly-date') return `每 ${form.repeat_interval} 月 · ${form.repeat_month_day} 日 · 共 ${count} 次`;
  if (form.repeat_type === 'monthly-weekday') {
    const weekLabel = form.repeat_month_week === 'last' ? '最后一周' : `第 ${form.repeat_month_week} 周`;
    const weekdayLabel = WEEKDAY_OPTIONS.find((item) => String(item.value) === String(form.repeat_month_weekday))?.label || '周一';
    return `每 ${form.repeat_interval} 月 · ${weekLabel}${weekdayLabel} · 共 ${count} 次`;
  }
  return '不重复';
}

function buildScheduleOccurrences(form) {
  const start = new Date(form.start_time);
  const end = new Date(form.end_time);
  const duration = end.getTime() - start.getTime();
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('结束时间必须晚于开始时间。');
  if (!form.repeat_type || form.repeat_type === 'none') return [{ start, end }];

  const interval = Math.min(4, Math.max(1, Number(form.repeat_interval) || 1));
  const until = form.repeat_until ? new Date(`${form.repeat_until}T23:59:59`) : addMonths(start, 3);
  const occurrences = [];

  if (form.repeat_type === 'weekly') {
    const weekdays = form.repeat_weekdays.length ? form.repeat_weekdays.map(Number) : [start.getDay()];
    const baseWeek = startOfWeek(start);
    for (let day = toLocalDay(start); day <= until; day.setDate(day.getDate() + 1)) {
      const weekDistance = Math.floor(daysBetween(baseWeek, startOfWeek(day)) / 7);
      if (weekDistance % interval !== 0 || !weekdays.includes(day.getDay())) continue;
      const occurrenceStart = withTimeFrom(day, start);
      if (occurrenceStart < start || occurrenceStart > until) continue;
      occurrences.push({ start: occurrenceStart, end: new Date(occurrenceStart.getTime() + duration) });
    }
  }

  if (form.repeat_type === 'monthly-date') {
    const dayOfMonth = Math.min(31, Math.max(1, Number(form.repeat_month_day) || start.getDate()));
    const baseMonth = start.getFullYear() * 12 + start.getMonth();
    const endMonth = until.getFullYear() * 12 + until.getMonth();
    for (let monthIndex = baseMonth; monthIndex <= endMonth; monthIndex += interval) {
      const year = Math.floor(monthIndex / 12);
      const month = monthIndex % 12;
      const occurrenceStart = new Date(year, month, dayOfMonth, start.getHours(), start.getMinutes(), 0, 0);
      if (occurrenceStart.getMonth() !== month || occurrenceStart < start || occurrenceStart > until) continue;
      occurrences.push({ start: occurrenceStart, end: new Date(occurrenceStart.getTime() + duration) });
    }
  }

  if (form.repeat_type === 'monthly-weekday') {
    const parsedWeekday = Number(form.repeat_month_weekday);
    const weekday = Number.isNaN(parsedWeekday) ? start.getDay() : parsedWeekday;
    const baseMonth = start.getFullYear() * 12 + start.getMonth();
    const endMonth = until.getFullYear() * 12 + until.getMonth();
    for (let monthIndex = baseMonth; monthIndex <= endMonth; monthIndex += interval) {
      const year = Math.floor(monthIndex / 12);
      const month = monthIndex % 12;
      const day = nthWeekdayOfMonth(year, month, weekday, form.repeat_month_week);
      if (!day) continue;
      const occurrenceStart = withTimeFrom(day, start);
      if (occurrenceStart < start || occurrenceStart > until) continue;
      occurrences.push({ start: occurrenceStart, end: new Date(occurrenceStart.getTime() + duration) });
    }
  }

  if (!occurrences.length) throw new Error('这个重复规则没有生成任何日程，请检查结束日期。');
  if (occurrences.length > 400) throw new Error('一次最多创建 400 条重复日程，请缩短重复结束日期。');
  return occurrences;
}

function hasReviewContent(journal, review) {
  const journalDone = JOURNAL_FIELDS.some((field) => Boolean(journal?.[field.key]?.trim?.()));
  return journalDone || Boolean(review?.summary?.trim?.());
}

function findDailyReview(data, dayKey) {
  const journal = data.journals.find((item) => item.review_date === dayKey) || null;
  const review =
    data.reviews.find(
      (item) => item.review_type === 'day' && item.period_start === dayKey && item.period_end === dayKey,
    ) || null;
  return {
    date: dayKey,
    journal,
    review,
    isDone: hasReviewContent(journal, review),
  };
}

function buildDailyReviewRecords(data) {
  const recordsByDate = new Map();

  data.journals.forEach((journal) => {
    if (!journal.review_date) return;
    recordsByDate.set(journal.review_date, findDailyReview(data, journal.review_date));
  });

  data.reviews
    .filter((review) => review.review_type === 'day' && review.period_start && review.period_end)
    .forEach((review) => {
      recordsByDate.set(review.period_start, findDailyReview(data, review.period_start));
    });

  return Array.from(recordsByDate.values()).sort((a, b) => b.date.localeCompare(a.date));
}

function formatReviewDate(dayKey) {
  const [year, month, day] = dayKey.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}

function getReviewPreview(record) {
  const summary = record.review?.summary?.trim?.();
  if (summary) return summary;
  const field = JOURNAL_FIELDS.map((item) => record.journal?.[item.key]?.trim?.()).find(Boolean);
  return field || '这天已经建立复盘记录，内容还没有填写。';
}

function getEmotionMeta(value) {
  const normalized = value?.trim?.();
  if (!normalized) return null;
  return EMOTION_LEVELS.find((item) => item.value === normalized || item.label === normalized || normalized.includes(item.label)) || null;
}

function getReviewEmotion(record) {
  return getEmotionMeta(record?.journal?.emotion_feeling);
}

function formatEmotionValue(value) {
  const emotion = getEmotionMeta(value);
  if (emotion) return `${emotion.icon} ${emotion.label}`;
  return value?.trim?.() || '未选择';
}

function bytesToBase64Url(bytes) {
  let text = '';
  bytes.forEach((byte) => {
    text += String.fromCharCode(byte);
  });
  return window.btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(text) {
  const encoded = new TextEncoder().encode(text);
  const digest = await window.crypto.subtle.digest('SHA-256', encoded);
  return bufferToHex(digest);
}

function createAgentToken() {
  const bytes = new Uint8Array(32);
  window.crypto.getRandomValues(bytes);
  return `et_${bytesToBase64Url(bytes)}`;
}

function Button({ children, variant = 'primary', size = 'md', className = '', ...props }) {
  return h(
    'button',
    {
      ...props,
      className: classNames('btn', `btn-${variant}`, `btn-${size}`, className),
      type: props.type || 'button',
    },
    children,
  );
}

function Field({ label, hint, children, wide = false }) {
  return h(
    'label',
    { className: classNames('field', wide && 'field-wide') },
    h('span', { className: 'field-label' }, label),
    children,
    hint ? h('small', { className: 'field-hint' }, hint) : null,
  );
}

function TextInput(props) {
  return h('input', { ...props, className: classNames('input', props.className) });
}

function TextArea(props) {
  return h('textarea', { ...props, className: classNames('textarea', props.className) });
}

function Select(props) {
  return h('select', { ...props, className: classNames('select', props.className) }, props.children);
}

function App() {
  const [session, setSession] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setBooting(false);
      return undefined;
    }

    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        setSession(data.session);
        setBooting(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setBooting(false);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  if (!hasSupabaseConfig) return h(SetupMissing);
  if (booting) return h(LoadingScreen, { label: '正在进入有效时间' });
  if (!session) return h(AuthPage);
  return h(MainApp, { session });
}

function SetupMissing() {
  return h(
    'main',
    { className: 'setup-page' },
    h('div', { className: 'brand-orb' }),
    h(
      'section',
      { className: 'setup-card' },
      h('p', { className: 'eyebrow' }, 'Effective Time / Setup'),
      h('h1', null, '有效时间还差一步配置'),
      h('p', { className: 'muted' }, getMissingConfigMessage()),
      h(
        'ol',
        { className: 'setup-list' },
        h('li', null, '在 Supabase 新建项目。'),
        h('li', null, '把 ', h('code', null, 'supabase/schema.sql'), ' 粘贴到 SQL Editor 并运行。'),
        h('li', null, '复制 ', h('code', null, '.env.example'), ' 为 ', h('code', null, '.env.local'), '。'),
        h('li', null, '填入项目 URL 和 anon key 后启动网站。'),
      ),
      h('p', { className: 'setup-note' }, '这样做后，登录、目标、任务、时间记录和每日复盘都会保存到云端。'),
    ),
  );
}

function LoadingScreen({ label }) {
  return h(
    'main',
    { className: 'loading-screen' },
    h('div', { className: 'loader-mark' }),
    h('p', null, label),
  );
}

function AuthPage() {
  const [mode, setMode] = useState('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'signUp') {
        const result = await supabase.auth.signUp({ email, password });
        throwIfError(result);
        setMessage('账号已创建。如果你的 Supabase 开启了邮箱验证，请先完成验证再登录。');
      } else {
        const result = await supabase.auth.signInWithPassword({ email, password });
        throwIfError(result);
      }
    } catch (err) {
      setError(err.message || '登录失败，请检查邮箱和密码。');
    } finally {
      setBusy(false);
    }
  }

  return h(
    'main',
    { className: 'auth-page' },
    h(
      'section',
      { className: 'auth-hero' },
      h('div', { className: 'hero-arc' }),
      h('p', { className: 'eyebrow' }, 'Where Profession Meets Truth'),
      h('h1', null, h('span', null, '看见时间'), h('span', null, '投入要事')),
      h(
        'p',
        { className: 'hero-copy' },
        '基于德鲁克《卓有成效管理者》开发的智能时间管理工具',
      ),
      h(
        'div',
        { className: 'hero-metrics' },
        h('span', null, h('strong', null, '24h'), ' 时间轴'),
        h('span', null, h('strong', null, 'Goal'), ' 目标投入'),
        h('span', null, h('strong', null, 'Awake'), ' 每日复盘'),
      ),
    ),
    h(
      'form',
      { className: 'auth-card', onSubmit: handleSubmit },
      h('p', { className: 'eyebrow' }, mode === 'signIn' ? 'Sign in' : 'Create account'),
      h('h2', null, mode === 'signIn' ? '登录有效时间' : '创建你的时间账户'),
      h(
        Field,
        { label: '邮箱' },
        h(TextInput, {
          type: 'email',
          value: email,
          onChange: (event) => setEmail(event.target.value),
          placeholder: 'you@example.com',
          required: true,
        }),
      ),
      h(
        Field,
        { label: '密码', hint: '至少 6 位' },
        h(TextInput, {
          type: 'password',
          value: password,
          onChange: (event) => setPassword(event.target.value),
          placeholder: '输入密码',
          minLength: 6,
          required: true,
        }),
      ),
      error ? h('p', { className: 'form-error' }, error) : null,
      message ? h('p', { className: 'form-success' }, message) : null,
      h(Button, { type: 'submit', disabled: busy, className: 'full-width' }, busy ? '处理中...' : mode === 'signIn' ? '登录' : '注册'),
      h(
        'button',
        {
          className: 'link-button',
          type: 'button',
          onClick: () => setMode(mode === 'signIn' ? 'signUp' : 'signIn'),
        },
        mode === 'signIn' ? '还没有账号？创建一个' : '已有账号？返回登录',
      ),
    ),
  );
}

function MainApp({ session }) {
  const [view, setView] = useState('today');
  const [selectedDate, setSelectedDate] = useState(dateKey());
  const [data, setData] = useState(EMPTY_DATA);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [now, setNow] = useState(new Date());
  const seededRef = useRef(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const fetchTables = useCallback(async () => {
    const [goals, tasks, schedules, segments, journals, reviews] = await Promise.all([
      supabase.from('goals').select('*').order('created_at', { ascending: true }),
      supabase.from('tasks').select('*').order('created_at', { ascending: false }),
      supabase.from('schedules').select('*').order('start_time', { ascending: true }),
      supabase.from('time_segments').select('*').order('start_time', { ascending: true }),
      supabase.from('review_journals').select('*').order('review_date', { ascending: false }),
      supabase.from('reviews').select('*').order('period_start', { ascending: false }),
    ]);

    return {
      goals: throwIfError(goals) || [],
      tasks: throwIfError(tasks) || [],
      schedules: throwIfError(schedules) || [],
      segments: throwIfError(segments) || [],
      journals: throwIfError(journals) || [],
      reviews: throwIfError(reviews) || [],
    };
  }, []);

  const loadData = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      let next = await fetchTables();
      if (next.goals.length === 0 && !seededRef.current) {
        seededRef.current = true;
        throwIfError(
          await supabase.from('goals').insert(
            DEFAULT_GOALS.map((goal) => ({ ...goal, user_id: session.user.id })),
          ),
        );
        next = await fetchTables();
      }
      setData(next);
    } catch (err) {
      setError(err.message || '读取数据失败。');
    } finally {
      setLoading(false);
    }
  }, [fetchTables, session.user.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const goalsById = useMemo(() => new Map(data.goals.map((goal) => [goal.id, goal])), [data.goals]);
  const activeGoals = useMemo(() => data.goals.filter((goal) => goal.status === 'active'), [data.goals]);
  const dayAnalysis = useMemo(
    () => buildDayAnalysis(data, selectedDate, now, goalsById),
    [data, selectedDate, now, goalsById],
  );

  async function runMutation(label, action, successMessage) {
    setBusy(label);
    setError('');
    setNotice('');
    try {
      const actionMessage = await action();
      await loadData();
      setNotice(successMessage || actionMessage || `${label}已完成`);
      window.setTimeout(() => setNotice(''), 2400);
    } catch (err) {
      setError(err.message || `${label}失败，请稍后再试。`);
    } finally {
      setBusy('');
    }
  }

  async function recalculateTaskDuration(taskId, patch = {}) {
    const result = await supabase
      .from('time_segments')
      .select('start_time,end_time,duration_seconds,is_running')
      .eq('source_type', 'task')
      .eq('source_id', taskId);
    const rows = throwIfError(result) || [];
    const total = rows.reduce((sum, segment) => {
      if (!segment.end_time) return sum;
      return sum + (segment.duration_seconds || secondsBetween(segment.start_time, segment.end_time));
    }, 0);
    throwIfError(await supabase.from('tasks').update({ total_duration_seconds: total, ...patch }).eq('id', taskId));
  }

  async function getRunningTaskSegments(taskId) {
    return (
      throwIfError(
        await supabase
          .from('time_segments')
          .select('*')
          .eq('source_type', 'task')
          .eq('source_id', taskId)
          .eq('is_running', true),
      ) || []
    );
  }

  function createGoal(form) {
    return runMutation('创建目标', async () => {
      throwIfError(await supabase.from('goals').insert({ ...form, user_id: session.user.id }));
    });
  }

  function toggleGoal(goal) {
    return runMutation('更新目标', async () => {
      const status = goal.status === 'active' ? 'inactive' : 'active';
      throwIfError(await supabase.from('goals').update({ status }).eq('id', goal.id));
    });
  }

  function deleteGoal(goal) {
    return runMutation('删除目标', async () => {
      throwIfError(await supabase.from('time_segments').delete().eq('goal_id', goal.id));
      throwIfError(await supabase.from('tasks').delete().eq('goal_id', goal.id));
      throwIfError(await supabase.from('schedules').delete().eq('goal_id', goal.id));
      throwIfError(await supabase.from('goals').delete().eq('id', goal.id));
    });
  }

  function dedupeGoals() {
    return runMutation('清理重复目标', async () => {
      const groups = new Map();
      data.goals.forEach((goal) => {
        const key = `${goal.category}::${goal.name.trim().toLowerCase()}`;
        groups.set(key, [...(groups.get(key) || []), goal]);
      });
      let removed = 0;
      for (const goals of groups.values()) {
        if (goals.length < 2) continue;
        const sorted = [...goals].sort((a, b) => {
          if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
          return new Date(a.created_at) - new Date(b.created_at);
        });
        const keeper = sorted[0];
        const duplicates = sorted.slice(1);
        for (const duplicate of duplicates) {
          throwIfError(await supabase.from('tasks').update({ goal_id: keeper.id, category: keeper.category }).eq('goal_id', duplicate.id));
          throwIfError(await supabase.from('schedules').update({ goal_id: keeper.id, category: keeper.category }).eq('goal_id', duplicate.id));
          throwIfError(await supabase.from('time_segments').update({ goal_id: keeper.id, category: keeper.category }).eq('goal_id', duplicate.id));
          throwIfError(await supabase.from('goals').delete().eq('id', duplicate.id));
          removed += 1;
        }
      }
      return removed ? `已清理 ${removed} 个重复目标` : '没有发现重复目标';
    });
  }

  function createTask(form) {
    return runMutation('创建任务', async () => {
      const category = getGoalCategory(form.goal_id, goalsById);
      throwIfError(
        await supabase.from('tasks').insert({
          ...form,
          user_id: session.user.id,
          category,
          goal_id: form.goal_id || null,
          due_time: fromDateTimeLocal(form.due_time),
          estimated_minutes: form.estimated_minutes ? Number(form.estimated_minutes) : null,
          status: 'not_started',
        }),
      );
    });
  }

  function startTask(task) {
    return runMutation('开始任务', async () => {
      if (task.status === 'completed') throw new Error('已完成的任务不能重新开始。');
      const running = await getRunningTaskSegments(task.id);
      if (running.length) throw new Error('这个任务已经在计时中。');
      const startedAt = new Date().toISOString();
      const goal = task.goal_id ? goalsById.get(task.goal_id) : null;
      throwIfError(
        await supabase.from('time_segments').insert({
          user_id: session.user.id,
          source_type: 'task',
          source_id: task.id,
          goal_id: task.goal_id || null,
          category: goal?.category || task.category || 'other',
          title: task.title,
          start_time: startedAt,
          duration_seconds: 0,
          is_running: true,
          is_manual: false,
          note: task.note || null,
        }),
      );
      throwIfError(await supabase.from('tasks').update({ status: 'running' }).eq('id', task.id));
    });
  }

  function pauseTask(task) {
    return runMutation('暂停任务', async () => {
      const running = await getRunningTaskSegments(task.id);
      if (!running.length) throw new Error('没有找到正在计时的片段。');
      const endedAt = new Date().toISOString();
      for (const segment of running) {
        throwIfError(
          await supabase
            .from('time_segments')
            .update({
              end_time: endedAt,
              duration_seconds: secondsBetween(segment.start_time, endedAt),
              is_running: false,
            })
            .eq('id', segment.id),
        );
      }
      await recalculateTaskDuration(task.id, { status: 'paused' });
    });
  }

  function completeTask(task) {
    return runMutation('完成任务', async () => {
      const completedAt = new Date().toISOString();
      const running = await getRunningTaskSegments(task.id);
      for (const segment of running) {
        throwIfError(
          await supabase
            .from('time_segments')
            .update({
              end_time: completedAt,
              duration_seconds: secondsBetween(segment.start_time, completedAt),
              is_running: false,
            })
            .eq('id', segment.id),
        );
      }
      await recalculateTaskDuration(task.id, { status: 'completed', completed_at: completedAt });
    });
  }

  function createSchedule(form) {
    return runMutation('创建日程', async () => {
      const occurrences = buildScheduleOccurrences(form);
      const goal = form.goal_id ? goalsById.get(form.goal_id) : null;
      const category = goal?.category || 'other';
      const repeatRule =
        form.repeat_type && form.repeat_type !== 'none'
          ? {
              type: form.repeat_type,
              interval: Math.min(4, Math.max(1, Number(form.repeat_interval) || 1)),
              weekdays: form.repeat_weekdays,
              month_day: form.repeat_month_day,
              month_week: form.repeat_month_week,
              month_weekday: form.repeat_month_weekday,
              until: form.repeat_until,
              summary: buildRepeatSummary(form, occurrences.length),
            }
          : null;
      const schedules = throwIfError(
        await supabase
          .from('schedules')
          .insert(occurrences.map((occurrence) => ({
            user_id: session.user.id,
            title: form.title,
            goal_id: form.goal_id || null,
            category,
            start_time: occurrence.start.toISOString(),
            end_time: occurrence.end.toISOString(),
            is_repeat: Boolean(repeatRule),
            repeat_rule: repeatRule,
            note: form.note || null,
          })))
          .select('*'),
      );
      throwIfError(
        await supabase.from('time_segments').insert(schedules.map((schedule) => ({
          user_id: session.user.id,
          source_type: 'schedule',
          source_id: schedule.id,
          goal_id: form.goal_id || null,
          category,
          title: form.title,
          start_time: schedule.start_time,
          end_time: schedule.end_time,
          duration_seconds: secondsBetween(schedule.start_time, schedule.end_time),
          is_running: false,
          is_manual: false,
          note: form.note || null,
        }))),
      );
      return occurrences.length > 1 ? `已创建 ${occurrences.length} 个重复日程` : '日程已创建';
    });
  }

  function updateSchedule(schedule, form) {
    return runMutation('修改日程', async () => {
      const startIso = fromDateTimeLocal(form.start_time);
      const endIso = fromDateTimeLocal(form.end_time);
      if (new Date(endIso) <= new Date(startIso)) throw new Error('结束时间必须晚于开始时间。');
      const goal = form.goal_id ? goalsById.get(form.goal_id) : null;
      const category = goal?.category || 'other';
      const payload = {
        title: form.title,
        goal_id: form.goal_id || null,
        category,
        start_time: startIso,
        end_time: endIso,
        note: form.note || null,
      };
      throwIfError(await supabase.from('schedules').update(payload).eq('id', schedule.id));
      throwIfError(
        await supabase
          .from('time_segments')
          .update({
            source_type: 'schedule',
            source_id: schedule.id,
            goal_id: form.goal_id || null,
            category,
            title: form.title,
            start_time: startIso,
            end_time: endIso,
            duration_seconds: secondsBetween(startIso, endIso),
            is_running: false,
            is_manual: false,
            note: form.note || null,
          })
          .eq('source_type', 'schedule')
          .eq('source_id', schedule.id),
      );
    });
  }

  function moveSchedule(schedule, startIso, endIso) {
    return updateSchedule(schedule, {
      title: schedule.title,
      goal_id: schedule.goal_id || '',
      start_time: toDateTimeLocal(startIso),
      end_time: toDateTimeLocal(endIso),
      note: schedule.note || '',
    });
  }

  function moveScheduleSegment(segment, startIso, endIso) {
    const schedule = data.schedules.find((item) => item.id === segment.source_id);
    if (!schedule) return Promise.reject(new Error('没有找到对应日程。'));
    return moveSchedule(schedule, startIso, endIso);
  }

  function deleteSchedule(schedule) {
    return runMutation('删除日程', async () => {
      throwIfError(await supabase.from('time_segments').delete().eq('source_type', 'schedule').eq('source_id', schedule.id));
      throwIfError(await supabase.from('schedules').delete().eq('id', schedule.id));
    });
  }

  function createManualSegment(form) {
    return runMutation('补录时间', async () => {
      const startIso = fromDateTimeLocal(form.start_time);
      const endIso = fromDateTimeLocal(form.end_time);
      if (form.source_type !== 'manual' && !form.source_id) throw new Error('请选择对应的任务或日程。');
      if (new Date(endIso) <= new Date(startIso)) throw new Error('结束时间必须晚于开始时间。');
      const goal = form.goal_id ? goalsById.get(form.goal_id) : null;
      const payload = {
        user_id: session.user.id,
        source_type: form.source_type,
        source_id: form.source_id || null,
        goal_id: form.goal_id || null,
        category: goal?.category || 'other',
        title: form.title,
        start_time: startIso,
        end_time: endIso,
        duration_seconds: secondsBetween(startIso, endIso),
        is_running: false,
        is_manual: true,
        note: form.note || null,
      };
      throwIfError(await supabase.from('time_segments').insert(payload));
      if (form.source_type === 'task' && form.source_id) await recalculateTaskDuration(form.source_id);
    });
  }

  function updateSegment(segment, form) {
    return runMutation('修改时间记录', async () => {
      const startIso = fromDateTimeLocal(form.start_time);
      const endIso = fromDateTimeLocal(form.end_time);
      if (new Date(endIso) <= new Date(startIso)) throw new Error('结束时间必须晚于开始时间。');
      const goal = form.goal_id ? goalsById.get(form.goal_id) : null;
      throwIfError(
        await supabase
          .from('time_segments')
          .update({
            title: form.title,
            goal_id: form.goal_id || null,
            category: goal?.category || 'other',
            start_time: startIso,
            end_time: endIso,
            duration_seconds: secondsBetween(startIso, endIso),
            is_running: false,
            note: form.note || null,
          })
          .eq('id', segment.id),
      );
      if (segment.source_type === 'task' && segment.source_id) {
        await recalculateTaskDuration(segment.source_id, segment.is_running ? { status: 'paused' } : {});
      }
    });
  }

  function deleteSegment(segment) {
    return runMutation('删除时间记录', async () => {
      throwIfError(await supabase.from('time_segments').delete().eq('id', segment.id));
      if (segment.source_type === 'task' && segment.source_id) {
        await recalculateTaskDuration(segment.source_id, segment.is_running ? { status: 'paused' } : {});
      }
    });
  }

  function saveReview(journalForm, summary) {
    return runMutation('保存复盘', async () => {
      throwIfError(
        await supabase.from('review_journals').upsert(
          {
            user_id: session.user.id,
            review_date: selectedDate,
            ...journalForm,
          },
          { onConflict: 'user_id,review_date' },
        ),
      );
      throwIfError(
        await supabase.from('reviews').upsert(
          {
            user_id: session.user.id,
            review_type: 'day',
            period_start: selectedDate,
            period_end: selectedDate,
            date_range: { start: selectedDate, end: selectedDate },
            summary,
          },
          { onConflict: 'user_id,review_type,period_start,period_end' },
        ),
      );
    }, '复盘已保存');
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  const commonProps = {
    session,
    data,
    goalsById,
    activeGoals,
    selectedDate,
    setSelectedDate,
    now,
    dayAnalysis,
    busy,
    actions: {
      createGoal,
      toggleGoal,
      deleteGoal,
      dedupeGoals,
      createTask,
      startTask,
      pauseTask,
      completeTask,
      createSchedule,
      updateSchedule,
      moveSchedule,
      moveScheduleSegment,
      deleteSchedule,
      createManualSegment,
      updateSegment,
      deleteSegment,
      saveReview,
      setView,
    },
  };

  return h(
    'div',
    { className: 'app-shell' },
    h(Sidebar, { view, setView, signOut, email: session.user.email }),
    h(
      'main',
      { className: 'main-panel' },
      h(Topbar, { selectedDate, setSelectedDate, view, reload: loadData, loading }),
      error ? h('div', { className: 'app-alert app-alert-error' }, error) : null,
      notice ? h('div', { className: 'app-alert app-alert-success' }, notice) : null,
      loading ? h(LoadingScreen, { label: '正在读取你的时间记录' }) : h(ViewRenderer, { view, ...commonProps }),
    ),
  );
}

function Sidebar({ view, setView, signOut, email }) {
  return h(
    'aside',
    { className: 'sidebar' },
    h(
      'div',
      { className: 'brand-lockup' },
      h('div', { className: 'brand-symbol' }, h('img', { src: '/focus-steer-logo.svg', alt: 'Focus Steer' })),
      h('div', null, h('strong', null, '有效时间'), h('span', null, 'Focus First.', h('br'), 'Steer Clear.')),
    ),
    h(
      'nav',
      { className: 'nav-list' },
      VIEWS.map((item) =>
        h(
          'button',
          {
            key: item.key,
            className: classNames('nav-item', view === item.key && 'active'),
            onClick: () => setView(item.key),
          },
          h('span', null, item.label),
          h('small', null, item.eyebrow),
        ),
      ),
    ),
    h(
      'div',
      { className: 'sidebar-footer' },
      h('span', null, email),
      h(Button, { variant: 'ghost', size: 'sm', onClick: signOut }, '退出'),
    ),
  );
}

function Topbar({ selectedDate, setSelectedDate, view, reload, loading }) {
  const current = VIEWS.find((item) => item.key === view) || VIEWS[0];
  return h(
    'header',
    { className: 'topbar' },
    h(
      'div',
      null,
      h('p', { className: 'eyebrow' }, current.eyebrow),
      h('h1', null, current.label),
    ),
    h(
      'div',
      { className: 'topbar-actions' },
      h(TextInput, {
        type: 'date',
        value: selectedDate,
        onChange: (event) => setSelectedDate(event.target.value),
        'aria-label': '选择日期',
      }),
      h(Button, { variant: 'secondary', onClick: reload, disabled: loading }, loading ? '读取中' : '刷新'),
    ),
  );
}

function ViewRenderer({ view, ...props }) {
  if (view === 'goals') return h(GoalsPage, props);
  if (view === 'tasks') return h(TasksPage, props);
  if (view === 'schedules') return h(SchedulesPage, props);
  if (view === 'timeline') return h(TimelinePage, props);
  if (view === 'dashboard') return h(DashboardPage, props);
  if (view === 'review') return h(ReviewPage, props);
  if (view === 'agent') return h(AgentPage, props);
  return h(TodayPage, props);
}

function TodayPage({ data, activeGoals, goalsById, selectedDate, now, dayAnalysis, actions, busy }) {
  const runningTasks = data.tasks.filter((task) => task.status === 'running');
  const todaysSchedules = data.schedules.filter(
    (schedule) => isSameLocalDate(schedule.start_time, selectedDate) || isSameLocalDate(schedule.end_time, selectedDate),
  );
  const activeTasks = data.tasks.filter(
    (task) =>
      task.status !== 'completed' &&
      (!task.due_time || isSameLocalDate(task.due_time, selectedDate) || new Date(task.due_time) < new Date(`${selectedDate}T23:59:59`)),
  );

  return h(
    'div',
    { className: 'page-stack' },
    h(
      'section',
      { className: 'today-hero panel' },
      h('div', { className: 'hero-arc thin' }),
      h('p', { className: 'eyebrow' }, 'Drucker Time System'),
      h('h2', null, '先知道时间去了哪里，再决定人生投向哪里。'),
      h(
        'div',
        { className: 'stat-grid hero-stat-grid' },
        h(StatCard, { label: '自然占用', value: formatDuration(dayAnalysis.naturalSeconds, true), tone: 'cyan' }),
        h(StatCard, { label: '目标投入', value: formatDuration(dayAnalysis.targetSeconds, true), tone: 'green' }),
        h(StatCard, { label: '时间碎片', value: `${dayAnalysis.fragmentCount} 段`, tone: 'blue' }),
        h(StatCard, { label: '复盘状态', value: dayAnalysis.reviewDone ? '已完成' : '未完成', tone: 'dark' }),
      ),
    ),
    h(
      'section',
      { className: 'two-column' },
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, { eyebrow: 'Running', title: '正在执行' }),
        runningTasks.length
          ? h(
              'div',
              { className: 'card-list' },
              runningTasks.map((task) =>
                h(TaskCard, {
                  key: task.id,
                  task,
                  goalsById,
                  segments: data.segments,
                  now,
                  actions,
                  busy,
                }),
              ),
            )
          : h(EmptyState, { title: '现在没有正在计时的任务', copy: '开始一个任务后，它会出现在这里。' }),
      ),
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, { eyebrow: 'Quick Add', title: '快速新增任务' }),
        h(TaskForm, { goals: activeGoals, onSubmit: actions.createTask, compact: true }),
      ),
    ),
    h(
      'section',
      { className: 'two-column' },
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, { eyebrow: 'Tasks', title: '今日任务' }),
        activeTasks.length
          ? h(
              'div',
              { className: 'card-list' },
              activeTasks.slice(0, 6).map((task) =>
                h(TaskCard, {
                  key: task.id,
                  task,
                  goalsById,
                  segments: data.segments,
                  now,
                  actions,
                  busy,
                }),
              ),
            )
          : h(EmptyState, { title: '今天还没有任务', copy: '可以从右上角日期切换其他日期，或立即创建任务。' }),
      ),
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, { eyebrow: 'Schedule', title: '今日日程' }),
        todaysSchedules.length
          ? h(
              'div',
              { className: 'schedule-list' },
              todaysSchedules.map((schedule) => h(ScheduleItem, { key: schedule.id, schedule, goalsById })),
            )
          : h(EmptyState, { title: '今天没有固定日程', copy: '日程会自动进入当天时间轴。' }),
      ),
    ),
    h(
      'section',
      { className: 'panel' },
      h(SectionTitle, { eyebrow: 'Timeline Preview', title: '今日 24 小时时间轴' }),
      h(Timeline, { segments: dayAnalysis.daySegments, goalsById, onEdit: null, compact: true, onMoveSchedule: actions.moveScheduleSegment }),
      h('div', { className: 'panel-actions' }, h(Button, { variant: 'secondary', onClick: () => actions.setView('timeline') }, '进入完整时间轴')),
    ),
  );
}

function GoalsPage({ data, activeGoals, goalsById, dayAnalysis, actions }) {
  const [activeCategory, setActiveCategory] = useState('work');
  const [pendingDelete, setPendingDelete] = useState(null);
  const goalSeconds = new Map(dayAnalysis.goalParts.map((part) => [part.key, part.seconds]));
  const categoryGoals = data.goals.filter((goal) => goal.category === activeCategory);
  const duplicateCount = data.goals.length - new Set(data.goals.map((goal) => `${goal.category}::${goal.name.trim().toLowerCase()}`)).size;
  function countsForGoal(goalId) {
    return {
      tasks: data.tasks.filter((task) => task.goal_id === goalId).length,
      schedules: data.schedules.filter((schedule) => schedule.goal_id === goalId).length,
    };
  }

  function requestDelete(goal) {
    const counts = countsForGoal(goal.id);
    if (counts.tasks === 0 && counts.schedules === 0) {
      actions.deleteGoal(goal);
      return;
    }
    setPendingDelete({ goal, counts });
  }

  return h(
    'div',
    { className: 'page-stack' },
    h(
      'section',
      { className: 'two-column' },
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, { eyebrow: 'Create Goal', title: '创建目标' }),
        h(GoalForm, { onSubmit: actions.createGoal }),
      ),
      h(
        'div',
        { className: 'panel brand-panel' },
        h('p', { className: 'eyebrow' }, 'Goal First'),
        h('h2', null, '目标不是分类标签，而是判断时间是否有效的标尺。'),
        h('p', null, `当前启用 ${activeGoals.length} 个目标，今天已投入 ${formatDuration(dayAnalysis.targetSeconds)}。`),
        duplicateCount
          ? h('div', { className: 'panel-actions' }, h(Button, { variant: 'dark', onClick: actions.dedupeGoals }, `清理 ${duplicateCount} 个重复目标`))
          : h('p', { className: 'subtle-line' }, '当前没有重复目标。'),
      ),
    ),
    h(
      'section',
      { className: 'category-tabs panel' },
      CATEGORY_OPTIONS.filter((item) => item.value !== 'other').map((item) => {
        const count = data.goals.filter((goal) => goal.category === item.value).length;
        return h(
          'button',
          {
            key: item.value,
            type: 'button',
            className: classNames('category-tab', activeCategory === item.value && 'active'),
            onClick: () => setActiveCategory(item.value),
          },
          h('span', { style: { background: item.color } }),
          h('strong', null, item.label),
          h('em', null, `${count} 个`),
        );
      }),
    ),
    h(
      'section',
      { className: 'goal-grid' },
      categoryGoals.length
        ? categoryGoals.map((goal) => {
          const counts = countsForGoal(goal.id);
          return h(
            'article',
            { key: goal.id, className: classNames('goal-card panel', goal.status === 'inactive' && 'is-muted') },
            h('div', { className: 'goal-color', style: { background: goal.color } }),
            h('p', { className: 'eyebrow' }, categoryMeta(goal.category).label),
            h('h3', null, goal.name),
            h('p', { className: 'muted' }, goal.description || '暂无描述'),
            h(
              'div',
              { className: 'goal-meta' },
              h('span', null, '今日投入'),
              h('strong', null, formatDuration(goalSeconds.get(goal.id) || 0, true)),
            ),
            h(
              'div',
              { className: 'goal-stats' },
              h('span', null, `${counts.tasks} 任务`),
              h('span', null, `${counts.schedules} 日程`),
              h('span', null, goal.status === 'active' ? '启用中' : '已停用'),
            ),
            h(
              'div',
              { className: 'panel-actions' },
              h(Button, { variant: goal.status === 'active' ? 'secondary' : 'primary', size: 'sm', onClick: () => actions.toggleGoal(goal) }, goal.status === 'active' ? '停用' : '启用'),
              h(Button, { variant: 'danger', size: 'sm', onClick: () => requestDelete(goal) }, '删除'),
            ),
          );
        })
        : h(EmptyState, { title: '这个大类还没有目标', copy: '可以先创建一个目标，再绑定任务或日程。' }),
    ),
    pendingDelete
      ? h(DeleteGoalModal, {
          goal: pendingDelete.goal,
          counts: pendingDelete.counts,
          onClose: () => setPendingDelete(null),
          onConfirm: () => actions.deleteGoal(pendingDelete.goal).then(() => setPendingDelete(null)),
        })
      : null,
  );
}

function DeleteGoalModal({ goal, counts, onClose, onConfirm }) {
  return h(
    'div',
    { className: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true' },
    h(
      'div',
      { className: 'modal-card panel' },
      h(SectionTitle, { eyebrow: 'Delete Goal', title: `删除「${goal.name}」？` }),
      h('p', { className: 'muted' }, `这个目标下有 ${counts.tasks} 个任务、${counts.schedules} 个日程。确认删除后，关联的任务、日程和时间记录也会一起删除。`),
      h(
        'div',
        { className: 'modal-actions' },
        h(Button, { variant: 'danger', onClick: onConfirm }, '确认删除'),
        h(Button, { variant: 'ghost', onClick: onClose }, '取消'),
      ),
    ),
  );
}

const TASK_PRIORITY_RANK = {
  high: 3,
  medium: 2,
  low: 1,
};

function sortTasksForList(tasks) {
  return [...tasks].sort((a, b) => {
    const priorityDiff = (TASK_PRIORITY_RANK[b.priority] || 0) - (TASK_PRIORITY_RANK[a.priority] || 0);
    if (priorityDiff) return priorityDiff;
    const goalDiff = Number(Boolean(b.goal_id)) - Number(Boolean(a.goal_id));
    if (goalDiff) return goalDiff;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
}

function TasksPage({ data, activeGoals, goalsById, now, actions, busy }) {
  const [statusFilter, setStatusFilter] = useState('all');
  const [goalFilter, setGoalFilter] = useState('all');
  const visibleTasks = sortTasksForList(data.tasks.filter((task) => {
    const statusMatch =
      statusFilter === 'all' ||
      (statusFilter === 'todo' ? task.status !== 'completed' : task.status === statusFilter);
    const goalMatch = goalFilter === 'all' || (goalFilter === 'none' ? !task.goal_id : task.goal_id === goalFilter);
    return statusMatch && goalMatch;
  }));
  const pendingTasks = visibleTasks.filter((task) => task.status !== 'completed');
  const completedTasks = visibleTasks.filter((task) => task.status === 'completed');

  return h(
    'div',
    { className: 'page-stack' },
    h(
      'section',
      { className: 'two-column' },
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, { eyebrow: 'Create Task', title: '创建任务' }),
        h(TaskForm, { goals: activeGoals, onSubmit: actions.createTask }),
      ),
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, { eyebrow: 'Filter', title: '筛选任务' }),
        h(
          'div',
          { className: 'form-grid' },
          h(
            Field,
            { label: '状态' },
            h(
              Select,
              { value: statusFilter, onChange: (event) => setStatusFilter(event.target.value) },
              h('option', { value: 'all' }, '全部任务'),
              h('option', { value: 'todo' }, '待完成'),
              h('option', { value: 'completed' }, '已完成'),
              h('option', { value: 'not_started' }, '未开始'),
              h('option', { value: 'running' }, '执行中'),
              h('option', { value: 'paused' }, '已暂停'),
            ),
          ),
          h(
            Field,
            { label: '目标' },
            h(
              Select,
              { value: goalFilter, onChange: (event) => setGoalFilter(event.target.value) },
              h('option', { value: 'all' }, '全部目标'),
              h('option', { value: 'none' }, '未绑定目标'),
              activeGoals.map((goal) => h('option', { key: goal.id, value: goal.id }, goal.name)),
            ),
          ),
        ),
        h('p', { className: 'muted' }, '排序规则：高优先级在前；同优先级下，已绑定目标的任务在前。'),
      ),
    ),
    h(
      'section',
      { className: 'panel' },
      h(SectionTitle, { eyebrow: 'Task Cards', title: `任务列表 · ${visibleTasks.length}` }),
      visibleTasks.length
        ? h(
            'div',
            { className: 'task-board' },
            h(TaskColumn, {
              title: '待完成',
              count: pendingTasks.length,
              tasks: pendingTasks,
              emptyTitle: '没有待完成任务',
              emptyCopy: '可以放松一下，或创建一个新的重要任务。',
              goalsById,
              segments: data.segments,
              now,
              actions,
              busy,
            }),
            h(TaskColumn, {
              title: '已完成',
              count: completedTasks.length,
              tasks: completedTasks,
              emptyTitle: '还没有完成任务',
              emptyCopy: '完成任务后会自动出现在这里。',
              goalsById,
              segments: data.segments,
              now,
              actions,
              busy,
            }),
          )
        : h(EmptyState, { title: '没有符合条件的任务', copy: '调整筛选条件，或创建一个新任务。' }),
    ),
  );
}

function TaskColumn({ title, count, tasks, emptyTitle, emptyCopy, goalsById, segments, now, actions, busy }) {
  return h(
    'div',
    { className: 'task-column' },
    h(
      'div',
      { className: 'task-column-head' },
      h('h3', null, title),
      h('span', null, `${count} 个`),
    ),
    tasks.length
      ? h(
          'div',
          { className: 'task-column-list' },
          tasks.map((task) =>
            h(TaskCard, {
              key: task.id,
              task,
              goalsById,
              segments,
              now,
              actions,
              busy,
            }),
          ),
        )
      : h(EmptyState, { title: emptyTitle, copy: emptyCopy }),
  );
}

function SchedulesPage({ data, activeGoals, goalsById, selectedDate, setSelectedDate, actions }) {
  const [calendarMode, setCalendarMode] = useState('week');
  const [editingSchedule, setEditingSchedule] = useState(null);
  const anchorDate = startOfLocalDate(selectedDate);
  const weekStart = startOfWeek(anchorDate);
  const weekEnd = endOfWeek(anchorDate);
  const monthStart = startOfMonth(anchorDate);
  const monthGridStart = startOfWeek(monthStart);
  const visibleDays =
    calendarMode === 'week'
      ? Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
      : Array.from({ length: 42 }, (_, index) => addDays(monthGridStart, index));
  const visibleSchedules = data.schedules.filter((schedule) => visibleDays.some((day) => scheduleOverlapsDay(schedule, day)));
  const calendarTitle =
    calendarMode === 'week'
      ? `${formatShortDate(weekStart)} - ${formatShortDate(weekEnd)}`
      : formatMonthTitle(anchorDate);

  function startOfLocalDate(dayKey) {
    return new Date(`${dayKey}T00:00:00`);
  }

  function moveCalendar(direction) {
    const next = calendarMode === 'week' ? addDays(anchorDate, direction * 7) : addMonths(anchorDate, direction);
    setSelectedDate(dateKey(next));
  }

  function jumpToday() {
    setSelectedDate(dateKey());
  }

  return h(
    'div',
    { className: 'page-stack' },
    h(
      'section',
      { className: 'two-column' },
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, { eyebrow: 'Create Schedule', title: '创建日程' }),
        h(ScheduleForm, { goals: activeGoals, onSubmit: actions.createSchedule }),
      ),
      h(
        'div',
        { className: 'panel brand-panel' },
        h('p', { className: 'eyebrow' }, 'Schedule To Time'),
        h('h2', null, '单次和重复日程，都会自动进入 24 小时时间轴。'),
        h('p', null, '支持按周、按月日期、按月第几周星期几重复创建。'),
      ),
    ),
    h(
      'section',
      { className: 'panel calendar-panel' },
      h(
        'div',
        { className: 'calendar-toolbar' },
        h(SectionTitle, { eyebrow: 'Calendar View', title: calendarMode === 'week' ? '周日历' : '月日历', copy: `当前范围：${calendarTitle}` }),
        h(
          'div',
          { className: 'calendar-actions' },
          h(Button, { variant: 'ghost', size: 'sm', onClick: () => moveCalendar(-1) }, '上一页'),
          h(Button, { variant: 'secondary', size: 'sm', onClick: jumpToday }, '回到今天'),
          h(Button, { variant: 'ghost', size: 'sm', onClick: () => moveCalendar(1) }, '下一页'),
          h(
            'div',
            { className: 'calendar-mode-toggle' },
            h('button', { type: 'button', className: calendarMode === 'week' ? 'active' : '', onClick: () => setCalendarMode('week') }, '周'),
            h('button', { type: 'button', className: calendarMode === 'month' ? 'active' : '', onClick: () => setCalendarMode('month') }, '月'),
          ),
        ),
      ),
      h(ScheduleCalendar, {
        mode: calendarMode,
        days: visibleDays,
        schedules: data.schedules,
        goalsById,
        anchorDate,
        selectedDate,
        onSelectDate: setSelectedDate,
        onEditSchedule: setEditingSchedule,
        onMoveSchedule: actions.moveSchedule,
      }),
      visibleSchedules.length ? null : h('p', { className: 'calendar-range-empty' }, '这个范围暂时没有日程。'),
    ),
    editingSchedule
      ? h(ScheduleEditorModal, {
          schedule: editingSchedule,
          goals: activeGoals,
          goalsById,
          onClose: () => setEditingSchedule(null),
          onSubmit: (form) => actions.updateSchedule(editingSchedule, form).then(() => setEditingSchedule(null)),
          onDelete: () => actions.deleteSchedule(editingSchedule).then(() => setEditingSchedule(null)),
        })
      : null,
  );
}

function ScheduleCalendar({ mode, days, schedules, goalsById, anchorDate, selectedDate, onSelectDate, onEditSchedule, onMoveSchedule }) {
  const weekGridRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [dragPreview, setDragPreview] = useState(null);

  useEffect(() => {
    function updateDrag(event, finish = false) {
      const drag = dragRef.current;
      const grid = weekGridRef.current;
      if (!drag || !grid) return;
      const rect = grid.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, 0, rect.width - 1);
      const y = clamp(event.clientY - rect.top, 0, rect.height - 1);
      const dayIndex = clamp(Math.floor(x / (rect.width / 7)), 0, 6);
      const snappedMinute = roundToSnap((y / CALENDAR_HOUR_HEIGHT) * 60);
      const nextStart = withTimeFrom(days[dayIndex], new Date(drag.schedule.start_time));
      nextStart.setHours(Math.floor(snappedMinute / 60), snappedMinute % 60, 0, 0);
      const nextEnd = new Date(nextStart.getTime() + drag.durationMs);
      const moved = Math.abs(event.clientX - drag.originX) > 4 || Math.abs(event.clientY - drag.originY) > 4;
      const preview = {
        id: drag.schedule.id,
        dayIndex,
        top: (snappedMinute / 60) * CALENDAR_HOUR_HEIGHT,
        start: nextStart,
        end: nextEnd,
        moved,
      };
      setDragPreview(preview);
      if (finish) {
        dragRef.current = null;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 80);
        if (moved) {
          suppressClickRef.current = true;
          onMoveSchedule(drag.schedule, nextStart.toISOString(), nextEnd.toISOString());
        }
        setDragPreview(null);
      }
    }

    function handlePointerMove(event) {
      if (!dragRef.current) return;
      event.preventDefault();
      updateDrag(event);
    }

    function handlePointerUp(event) {
      if (!dragRef.current) return;
      event.preventDefault();
      updateDrag(event, true);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [days, onMoveSchedule]);

  function startDrag(event, schedule) {
    if (mode !== 'week' || event.button !== 0) return;
    dragRef.current = {
      schedule,
      durationMs: Math.max(15 * 60000, new Date(schedule.end_time) - new Date(schedule.start_time)),
      originX: event.clientX,
      originY: event.clientY,
    };
  }

  if (mode === 'week') {
    const hours = Array.from({ length: 24 }, (_, index) => index);
    return h(
      'div',
      { className: 'schedule-calendar week-view timed-view' },
      h(
        'div',
        { className: 'calendar-weekdays timed' },
        h('span', { className: 'calendar-time-corner' }, '时间'),
        days.map((day) => {
          const dayKey = dateKey(day);
          const meta = getDateMeta(day);
          return h(
            'button',
            {
              key: dayKey,
              type: 'button',
              className: classNames(dayKey === selectedDate && 'active'),
              onClick: () => onSelectDate(dayKey),
            },
            h('strong', null, WEEKDAY_OPTIONS.find((item) => item.value === day.getDay())?.label),
            h('small', null, formatShortDate(day)),
            h(
              'span',
              { className: 'calendar-date-meta' },
              meta.solarTerm || meta.holiday || meta.lunar,
            ),
            meta.workday ? h('em', { className: 'date-badge workday' }, meta.workday) : null,
          );
        }),
      ),
      h(
        'div',
        { className: 'week-calendar-body', style: { '--calendar-hour-height': `${CALENDAR_HOUR_HEIGHT}px` } },
        h(
          'div',
          { className: 'week-time-rail' },
          hours.map((hour) => h('span', { key: hour, style: { top: `${hour * CALENDAR_HOUR_HEIGHT}px` } }, `${String(hour).padStart(2, '0')}:00`)),
        ),
        h(
          'div',
          { className: 'week-grid', ref: weekGridRef },
          days.map((day, dayIndex) =>
            h(
              'div',
              { key: dateKey(day), className: 'week-day-lane' },
              hours.map((hour) => h('span', { key: hour, className: 'week-hour-line', style: { top: `${hour * CALENDAR_HOUR_HEIGHT}px` } })),
              scheduleLayoutForDay(schedules, day).map((item) => {
                const width = 100 / item.laneCount;
                const preview = dragPreview?.id === item.schedule.id ? dragPreview : null;
                const top = preview ? preview.top : (item.startMinute / 60) * CALENDAR_HOUR_HEIGHT;
                const height = Math.max(42, ((item.endMinute - item.startMinute) / 60) * CALENDAR_HOUR_HEIGHT);
                return h(CalendarEvent, {
                  key: `${dateKey(day)}-${item.schedule.id}`,
                  schedule: item.schedule,
                  goalsById,
                  compact: false,
                  timed: true,
                  short: height < 68,
                  crowded: item.laneCount > 1,
                  dragging: Boolean(preview),
                  onPointerDown: (event) => startDrag(event, item.schedule),
                  onClick: () => {
                    if (suppressClickRef.current) return;
                    onEditSchedule(item.schedule);
                  },
                  style: {
                    top: `${top}px`,
                    height: `${height}px`,
                    left: `calc(${item.lane * width}% + 4px)`,
                    width: `calc(${width}% - 8px)`,
                  },
                });
              }),
            ),
          ),
        ),
      ),
    );
  }

  return h(
    'div',
    { className: 'schedule-calendar month-view' },
    h(
      'div',
      { className: 'calendar-weekdays' },
      WEEKDAY_OPTIONS.map((item) => h('span', { key: item.value }, item.label)),
    ),
    h(
      'div',
      { className: 'calendar-grid' },
      days.map((day) => {
        const dayKey = dateKey(day);
        const daySchedules = schedulesForDay(schedules, day);
        const outsideMonth = mode === 'month' && day.getMonth() !== anchorDate.getMonth();
        const meta = getDateMeta(day);
        return h(
          'div',
          {
            key: dayKey,
            role: 'button',
            tabIndex: 0,
            className: classNames('calendar-day', outsideMonth && 'outside-month', dayKey === selectedDate && 'selected'),
            onClick: () => onSelectDate(dayKey),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') onSelectDate(dayKey);
            },
          },
          h(
            'div',
            { className: 'calendar-day-head' },
            h('div', null, h('strong', null, day.getDate()), h('small', null, meta.lunar)),
            h('span', null, `${daySchedules.length} 项`),
          ),
          h(
            'div',
            { className: 'calendar-day-tags' },
            meta.holiday ? h('em', { className: 'date-badge holiday' }, meta.holiday) : null,
            meta.workday ? h('em', { className: 'date-badge workday' }, meta.workday) : null,
            meta.solarTerm ? h('em', { className: 'date-badge term' }, meta.solarTerm) : null,
          ),
          daySchedules.length
            ? h(
                'div',
                { className: 'calendar-events' },
                daySchedules.slice(0, mode === 'week' ? 8 : 4).map((schedule) =>
                  h(CalendarEvent, {
                    key: `${dayKey}-${schedule.id}`,
                    schedule,
                    goalsById,
                    compact: true,
                    onClick: (event) => {
                      event.stopPropagation();
                      onEditSchedule(schedule);
                    },
                  }),
                ),
                daySchedules.length > (mode === 'week' ? 8 : 4)
                  ? h('em', { className: 'calendar-more' }, `还有 ${daySchedules.length - (mode === 'week' ? 8 : 4)} 项`)
                  : null,
              )
            : h('p', { className: 'calendar-empty' }, '空'),
        );
      }),
    ),
  );
}

function CalendarEvent({ schedule, goalsById, compact, timed = false, short = false, crowded = false, dragging = false, style, onPointerDown, onClick }) {
  const goal = schedule.goal_id ? goalsById.get(schedule.goal_id) : null;
  return h(
    'button',
    {
      type: 'button',
      className: classNames(
        'calendar-event',
        compact && 'compact',
        timed && 'timed',
        timed && short && 'short',
        timed && crowded && 'crowded',
        dragging && 'dragging',
      ),
      style: { '--event-color': getGoalColor(schedule.goal_id, goalsById), ...style },
      title: `${schedule.title}\n${formatScheduleRange(schedule)}\n${goal?.name || '其他日程'}${schedule.note ? `\n${schedule.note}` : ''}`,
      onPointerDown,
      onClick,
    },
    h('strong', null, schedule.title),
    timed ? null : h('span', null, formatScheduleRange(schedule)),
    !compact && !timed ? h('small', null, goal?.name || '其他日程') : null,
  );
}

function TimelinePage({ data, activeGoals, goalsById, selectedDate, dayAnalysis, actions }) {
  const [editing, setEditing] = useState(null);
  return h(
    'div',
    { className: 'page-stack' },
    h(
      'section',
      { className: 'two-column timeline-tools' },
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, { eyebrow: 'Manual Record', title: '手动补录时间' }),
        h(TimeEntryForm, {
          goals: activeGoals,
          tasks: data.tasks,
          schedules: data.schedules,
          goalsById,
          selectedDate,
          onSubmit: actions.createManualSegment,
        }),
      ),
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, { eyebrow: 'Day Summary', title: '当天概览' }),
        h(
          'div',
          { className: 'stat-grid compact' },
          h(StatCard, { label: '真实占用', value: formatDuration(dayAnalysis.naturalSeconds, true), tone: 'cyan' }),
          h(StatCard, { label: '重叠时间', value: formatDuration(dayAnalysis.overlapSeconds, true), tone: 'blue' }),
          h(StatCard, { label: '最长片段', value: formatDuration(dayAnalysis.longestSeconds, true), tone: 'green' }),
          h(StatCard, { label: '片段数量', value: `${dayAnalysis.fragmentCount}`, tone: 'dark' }),
        ),
      ),
    ),
    h(
      'section',
      { className: 'panel' },
      h(SectionTitle, { eyebrow: '24H Timeline', title: '24 小时时间轴' }),
      h(Timeline, { segments: dayAnalysis.daySegments, goalsById, onEdit: setEditing, onMoveSchedule: actions.moveScheduleSegment }),
    ),
    editing
      ? h(SegmentEditorModal, {
          segment: editing,
          goals: activeGoals,
          goalsById,
          onClose: () => setEditing(null),
          onSubmit: (form) => actions.updateSegment(editing, form).then(() => setEditing(null)),
          onDelete: () => actions.deleteSegment(editing).then(() => setEditing(null)),
        })
      : null,
  );
}

function DashboardPage({ dayAnalysis }) {
  return h(
    'div',
    { className: 'page-stack' },
    h(
      'section',
      { className: 'stat-grid' },
      h(StatCard, { label: '今日自然占用时间', value: formatDuration(dayAnalysis.naturalSeconds), tone: 'cyan' }),
      h(StatCard, { label: '今日任务累计时间', value: formatDuration(dayAnalysis.taskSeconds), tone: 'blue' }),
      h(StatCard, { label: '今日目标投入时间', value: formatDuration(dayAnalysis.targetSeconds), tone: 'green' }),
      h(StatCard, { label: '今日非目标时间', value: formatDuration(dayAnalysis.nonTargetSeconds), tone: 'gray' }),
      h(StatCard, { label: '今日重叠时间', value: formatDuration(dayAnalysis.overlapSeconds), tone: 'dark' }),
      h(StatCard, { label: '今日完成任务数', value: `${dayAnalysis.completedTaskCount} 个`, tone: 'cyan' }),
      h(StatCard, { label: '今日最长专注片段', value: formatDuration(dayAnalysis.longestSeconds), tone: 'green' }),
      h(StatCard, { label: '今日时间碎片数', value: `${dayAnalysis.fragmentCount} 段`, tone: 'blue' }),
    ),
    h(
      'section',
      { className: 'chart-grid' },
      h(DonutPanel, { title: '目标时间占比', eyebrow: 'Goals', parts: dayAnalysis.goalParts }),
      h(DonutPanel, { title: '大类时间占比', eyebrow: 'Categories', parts: dayAnalysis.categoryParts }),
      h(BarPanel, { title: '任务耗时排行', eyebrow: 'Ranking', items: dayAnalysis.taskRanking, valueLabel: (item) => formatDuration(item.seconds, true) }),
      h(FocusPanel, { title: '专注片段分布', eyebrow: 'Fragments', buckets: dayAnalysis.focusBuckets }),
    ),
    h(
      'section',
      { className: 'panel' },
      h(SectionTitle, { eyebrow: 'Timeline', title: '当天真实时间流向' }),
      h(Timeline, { segments: dayAnalysis.daySegments, goalsById: dayAnalysis.goalsById, onEdit: null, compact: true }),
    ),
  );
}

function ReviewPage({ data, activeGoals, goalsById, selectedDate, setSelectedDate, now, dayAnalysis, actions }) {
  const currentRecord = findDailyReview(data, selectedDate);
  const reviewRecords = useMemo(() => buildDailyReviewRecords(data), [data]);
  const [detailDate, setDetailDate] = useState(null);
  const detailRecord = detailDate ? findDailyReview(data, detailDate) : null;
  const detailAnalysis = detailDate ? buildDayAnalysis(data, detailDate, now, goalsById) : null;

  function editReviewDate(dayKey) {
    setSelectedDate(dayKey);
    setDetailDate(null);
  }

  return h(
    'div',
    { className: 'page-stack' },
    h(
      'section',
      { className: 'panel review-hero' },
      h('p', { className: 'eyebrow' }, 'Daily Review'),
      h('h2', null, dayAnalysis.reviewDone ? '今天已经完成觉察。' : '用 5 分钟，把今天真正看清楚。'),
      h(
        'div',
        { className: 'stat-grid compact' },
        h(StatCard, { label: '目标投入', value: formatDuration(dayAnalysis.targetSeconds, true), tone: 'green' }),
        h(StatCard, { label: '非目标时间', value: formatDuration(dayAnalysis.nonTargetSeconds, true), tone: 'gray' }),
        h(StatCard, { label: '最长专注', value: formatDuration(dayAnalysis.longestSeconds, true), tone: 'cyan' }),
        h(StatCard, { label: '碎片数量', value: `${dayAnalysis.fragmentCount}`, tone: 'blue' }),
      ),
    ),
    h(
      'section',
      { className: 'panel' },
      h(SectionTitle, {
        eyebrow: 'Review Archive',
        title: '复盘记录',
        copy: '每天只保留一条复盘记录。保存后，可以从这里点击回看当天详情，也能看到情绪变化。',
      }),
      h(EmotionTrendPanel, { records: reviewRecords }),
      h(ReviewRecordList, {
        records: reviewRecords,
        selectedDate,
        onOpen: setDetailDate,
        onEdit: editReviewDate,
      }),
    ),
    h(
      'section',
      { className: 'two-column review-layout' },
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, { eyebrow: 'Awake Journal', title: '觉醒日记' }),
        h(ReviewForm, { journal: currentRecord.journal, review: currentRecord.review, onSubmit: actions.saveReview }),
      ),
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, { eyebrow: 'Correction', title: '补录遗漏事项' }),
        h(TimeEntryForm, {
          goals: activeGoals,
          tasks: data.tasks,
          schedules: data.schedules,
          goalsById,
          selectedDate,
          onSubmit: actions.createManualSegment,
        }),
      ),
    ),
    detailRecord
      ? h(ReviewDetailModal, {
          record: detailRecord,
          analysis: detailAnalysis,
          onClose: () => setDetailDate(null),
          onEdit: () => editReviewDate(detailRecord.date),
        })
      : null,
  );
}

function ReviewRecordList({ records, selectedDate, onOpen, onEdit }) {
  if (!records.length) {
    return h(EmptyState, {
      title: '还没有复盘记录',
      copy: '填写并保存一次每日复盘后，这里会生成一条当天记录。',
    });
  }

  return h(
    'div',
    { className: 'review-record-list' },
    records.map((record) =>
      {
        const emotion = getReviewEmotion(record);
        return h(
          'article',
          { key: record.date, className: classNames('review-record-card', record.date === selectedDate && 'is-current') },
          h(
            'span',
            {
              className: classNames('review-emotion-icon', !emotion && 'is-empty'),
              style: emotion ? { '--emotion-color': emotion.color } : undefined,
            },
            emotion?.icon || '○',
          ),
        h(
          'button',
          {
            type: 'button',
            className: 'review-record-main',
            onClick: () => onOpen(record.date),
          },
          h('span', { className: 'review-record-date' }, formatReviewDate(record.date)),
          h('strong', null, record.isDone ? '已完成复盘' : '待补充内容'),
          h('p', null, emotion ? `${emotion.label} · ${getReviewPreview(record)}` : getReviewPreview(record)),
        ),
        h(
          'div',
          { className: 'review-record-actions' },
          record.date === selectedDate ? h('span', { className: 'status-pill running' }, '当前日期') : null,
          h(Button, { variant: 'secondary', size: 'sm', onClick: () => onOpen(record.date) }, '查看详情'),
          h(Button, { variant: 'ghost', size: 'sm', onClick: () => onEdit(record.date) }, '编辑这天'),
        ),
        );
      },
    ),
  );
}

function EmotionTrendPanel({ records }) {
  const items = records
    .map((record) => ({ record, emotion: getReviewEmotion(record) }))
    .filter((item) => item.emotion)
    .slice(0, 14)
    .reverse();

  if (!items.length) return null;

  return h(
    'div',
    { className: 'emotion-trend-panel' },
    h('div', { className: 'emotion-trend-head' }, h('strong', null, '情绪变化'), h('span', null, '按保存日期从左到右')),
    h(
      'div',
      { className: 'emotion-trend-list' },
      items.map(({ record, emotion }) =>
        h(
          'div',
          {
            key: record.date,
            className: 'emotion-trend-item',
            style: { '--emotion-color': emotion.color, '--emotion-height': `${emotion.score * 18 + 18}px` },
            title: `${formatReviewDate(record.date)}：${emotion.label}`,
          },
          h('i', null),
          h('span', null, emotion.icon),
          h('small', null, record.date.slice(5).replace('-', '/')),
        ),
      ),
    ),
  );
}

function ReviewDetailModal({ record, analysis, onClose, onEdit }) {
  const emotion = getReviewEmotion(record);
  return h(
    'div',
    { className: 'modal-backdrop', onClick: onClose },
    h(
      'article',
      { className: 'panel modal-card review-detail-card', onClick: (event) => event.stopPropagation() },
      h(
        'div',
        { className: 'review-detail-emotion', style: emotion ? { '--emotion-color': emotion.color } : undefined },
        h('span', null, emotion?.icon || '○'),
        h('div', null, h('strong', null, emotion?.label || '未选择情绪'), h('small', null, '当天情绪等级')),
      ),
      h(SectionTitle, {
        eyebrow: 'Review Detail',
        title: `${formatReviewDate(record.date)} 复盘详情`,
        copy: record.isDone ? '这是当天保存的完整复盘记录。' : '这天已经有一条复盘记录，但内容还没有填写完整。',
      }),
      h(
        'div',
        { className: 'stat-grid compact' },
        h(StatCard, { label: '目标投入', value: formatDuration(analysis?.targetSeconds || 0, true), tone: 'green' }),
        h(StatCard, { label: '非目标时间', value: formatDuration(analysis?.nonTargetSeconds || 0, true), tone: 'gray' }),
        h(StatCard, { label: '最长专注', value: formatDuration(analysis?.longestSeconds || 0, true), tone: 'cyan' }),
        h(StatCard, { label: '时间碎片', value: `${analysis?.fragmentCount || 0} 段`, tone: 'blue' }),
      ),
      h(
        'div',
        { className: 'review-detail-summary' },
        h('span', null, '今日复盘总结'),
        h('p', null, record.review?.summary?.trim?.() || '未填写'),
      ),
      h(
        'div',
        { className: 'review-detail-fields' },
        JOURNAL_FIELDS.map((field) =>
          h(
            'div',
            { key: field.key, className: 'review-detail-field' },
            h('span', null, field.label),
            h('p', null, field.key === 'emotion_feeling' ? formatEmotionValue(record.journal?.[field.key]) : record.journal?.[field.key]?.trim?.() || '未填写'),
          ),
        ),
      ),
      h(
        'div',
        { className: 'modal-actions' },
        h(Button, { variant: 'secondary', onClick: onClose }, '关闭'),
        h(Button, { onClick: onEdit }, '编辑这天复盘'),
      ),
    ),
  );
}

function AgentPage({ session }) {
  const [agentMeta, setAgentMeta] = useState(session.user.user_metadata?.effective_time_agent || null);
  const [newToken, setNewToken] = useState('');
  const [copyNotice, setCopyNotice] = useState('');
  const [working, setWorking] = useState(false);
  const siteOrigin = window.location.origin;
  const apiUrl = `${siteOrigin}/api/agent-sync`;
  const downloadUrl = `${siteOrigin}/effective-time-remote-mcp.cjs`;
  const tokenForConfig = newToken || '粘贴你刚生成的 Agent 口令';
  const configText = `[mcp_servers.effective-time]\ncommand = "node"\nargs = ["/你电脑上的路径/effective-time-remote-mcp.cjs"]\nenv = { EFFECTIVE_TIME_API_URL = "${apiUrl}", EFFECTIVE_TIME_AGENT_TOKEN = "${tokenForConfig}" }\n`;
  const installText = `curl -L ${downloadUrl} -o ~/effective-time-remote-mcp.cjs`;
  const isActive = agentMeta?.status === 'active' && agentMeta?.token_hash;

  async function copyText(text, label = '已复制') {
    await navigator.clipboard.writeText(text);
    setCopyNotice(label);
    window.setTimeout(() => setCopyNotice(''), 2200);
  }

  async function refreshUserMeta() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    setAgentMeta(data.user?.user_metadata?.effective_time_agent || null);
  }

  async function generateToken() {
    setWorking(true);
    setCopyNotice('');
    try {
      const token = createAgentToken();
      const token_hash = await sha256Hex(token);
      const nextMeta = {
        token_hash,
        token_prefix: `${token.slice(0, 10)}...${token.slice(-4)}`,
        status: 'active',
        created_at: new Date().toISOString(),
        last_used_at: null,
      };
      const { error } = await supabase.auth.updateUser({
        data: {
          ...(session.user.user_metadata || {}),
          effective_time_agent: nextMeta,
        },
      });
      if (error) throw error;
      setNewToken(token);
      setAgentMeta(nextMeta);
      await copyText(token, '新的 Agent 口令已复制');
    } catch (err) {
      setCopyNotice(err.message || '生成失败');
    } finally {
      setWorking(false);
    }
  }

  async function revokeToken() {
    setWorking(true);
    setCopyNotice('');
    try {
      const nextMeta = {
        ...(agentMeta || {}),
        token_hash: null,
        status: 'revoked',
        revoked_at: new Date().toISOString(),
      };
      const { error } = await supabase.auth.updateUser({
        data: {
          ...(session.user.user_metadata || {}),
          effective_time_agent: nextMeta,
        },
      });
      if (error) throw error;
      setNewToken('');
      setAgentMeta(nextMeta);
      await refreshUserMeta();
      setCopyNotice('已撤销旧口令');
    } catch (err) {
      setCopyNotice(err.message || '撤销失败');
    } finally {
      setWorking(false);
    }
  }

  return h(
    'div',
    { className: 'page-stack' },
    h(
      'section',
      { className: 'panel agent-hero' },
      h('p', { className: 'eyebrow' }, 'Agent Access'),
      h('h2', null, '让 Codex 只操作自己的有效时间。'),
      h(
        'p',
        { className: 'muted' },
        '这里生成的是个人口令，只绑定当前登录账号。它不能看到后台密钥，也不能操作别人的数据。',
      ),
      h(
        'div',
        { className: 'agent-status-row' },
        h(StatCard, { label: '当前状态', value: isActive ? '已开启' : '未开启', tone: isActive ? 'green' : 'gray' }),
        h(StatCard, { label: '口令标识', value: agentMeta?.token_prefix || '未生成', tone: 'cyan' }),
        h(StatCard, { label: '最近使用', value: agentMeta?.last_used_at ? formatClock(agentMeta.last_used_at) : '暂无', tone: 'blue' }),
      ),
      copyNotice ? h('div', { className: 'agent-copy-notice' }, copyNotice) : null,
    ),
    h(
      'section',
      { className: 'two-column agent-layout' },
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, {
          eyebrow: 'Step 1',
          title: '生成个人 Agent 口令',
          copy: '口令只显示一次。请复制到自己的 Codex 配置里，不要发给别人。',
        }),
        newToken
          ? h(
              'div',
              { className: 'agent-token-box' },
              h(TextArea, { value: newToken, readOnly: true, rows: 3 }),
              h(Button, { onClick: () => copyText(newToken, 'Agent 口令已复制') }, '复制口令'),
            )
          : h(EmptyState, {
              title: isActive ? '已有一个可用口令' : '还没有个人口令',
              copy: isActive ? '出于安全原因，旧口令不会再次明文显示。如忘记了，请重新生成。' : '点击下面按钮生成一个只属于你的 Agent 口令。',
            }),
        h(
          'div',
          { className: 'form-actions' },
          h(Button, { onClick: generateToken, disabled: working }, working ? '处理中' : isActive ? '重新生成口令' : '生成口令'),
          isActive ? h(Button, { variant: 'secondary', onClick: revokeToken, disabled: working }, '撤销口令') : null,
        ),
      ),
      h(
        'div',
        { className: 'panel' },
        h(SectionTitle, {
          eyebrow: 'Step 2',
          title: '安装 MCP 接口',
          copy: '同事只需要下载这个轻量 MCP 文件，再把下面配置放进自己的 Codex。',
        }),
        h('div', { className: 'agent-config-block' }, h('span', null, '下载 MCP 文件'), h('code', null, installText)),
        h(Button, { variant: 'secondary', onClick: () => copyText(installText, '下载命令已复制') }, '复制下载命令'),
        h('div', { className: 'agent-config-block' }, h('span', null, 'Codex 配置'), h('pre', null, configText)),
        h(Button, { onClick: () => copyText(configText, 'MCP 配置已复制') }, '复制 MCP 配置'),
      ),
    ),
    h(
      'section',
      { className: 'panel' },
      h(SectionTitle, {
        eyebrow: 'What it can do',
        title: '这个接口能做什么',
        copy: '接入后，Codex 可以为当前账号创建任务、开始/暂停/完成任务、创建日程、补录或修改时间、保存每日复盘。',
      }),
      h(
        'div',
        { className: 'agent-capability-grid' },
        ['创建任务', '开始/暂停/完成', '创建日程', '补录时间', '修改时间记录', '保存每日复盘'].map((item) =>
          h('span', { key: item }, item),
        ),
      ),
    ),
  );
}

function SectionTitle({ eyebrow, title, copy }) {
  return h(
    'div',
    { className: 'section-title' },
    h('p', { className: 'eyebrow' }, eyebrow),
    h('h2', null, title),
    copy ? h('p', { className: 'muted' }, copy) : null,
  );
}

function EmptyState({ title, copy }) {
  return h('div', { className: 'empty-state' }, h('strong', null, title), h('p', null, copy));
}

function StatCard({ label, value, tone = 'cyan' }) {
  return h(
    'article',
    { className: classNames('stat-card', `tone-${tone}`) },
    h('span', null, label),
    h('strong', null, value),
  );
}

function GoalForm({ onSubmit }) {
  const [form, setForm] = useState({
    name: '',
    category: 'work',
    description: '',
    color: BRAND_COLORS[0],
    status: 'active',
  });

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({ ...form, name: form.name.trim(), description: form.description.trim() || null });
    setForm({ name: '', category: 'work', description: '', color: BRAND_COLORS[0], status: 'active' });
  }

  return h(
    'form',
    { className: 'form-grid', onSubmit: submit },
    h(Field, { label: '目标名称' }, h(TextInput, { value: form.name, onChange: (event) => update('name', event.target.value), placeholder: '例如：AI 工作流建设', required: true })),
    h(
      Field,
      { label: '所属大类' },
      h(
        Select,
        { value: form.category, onChange: (event) => update('category', event.target.value) },
        CATEGORY_OPTIONS.filter((item) => item.value !== 'other').map((item) => h('option', { key: item.value, value: item.value }, item.label)),
      ),
    ),
    h(
      Field,
      { label: '目标颜色' },
      h(
        'div',
        { className: 'color-row' },
        BRAND_COLORS.map((color) =>
          h('button', {
            key: color,
            type: 'button',
            className: classNames('color-dot', form.color === color && 'active'),
            style: { background: color },
            onClick: () => update('color', color),
            'aria-label': `选择颜色 ${color}`,
          }),
        ),
      ),
    ),
    h(Field, { label: '目标描述', wide: true }, h(TextArea, { value: form.description, onChange: (event) => update('description', event.target.value), placeholder: '说明这个目标为什么重要', rows: 3 })),
    h('div', { className: 'form-actions field-wide' }, h(Button, { type: 'submit' }, '创建目标')),
  );
}

function TaskForm({ goals, onSubmit, compact = false }) {
  const [form, setForm] = useState({
    title: '',
    goal_id: '',
    due_time: '',
    estimated_minutes: '',
    priority: 'medium',
    note: '',
  });

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) return;
    onSubmit({ ...form, title: form.title.trim(), note: form.note.trim() || null });
    setForm({ title: '', goal_id: '', due_time: '', estimated_minutes: '', priority: 'medium', note: '' });
  }

  return h(
    'form',
    { className: classNames('form-grid', compact && 'compact-form'), onSubmit: submit },
    h(Field, { label: '任务名称' }, h(TextInput, { value: form.title, onChange: (event) => update('title', event.target.value), placeholder: '例如：搭建 AI 智能体', required: true })),
    h(
      Field,
      { label: '所属目标' },
      h(
        Select,
        { value: form.goal_id, onChange: (event) => update('goal_id', event.target.value) },
        h('option', { value: '' }, '不绑定目标'),
        goals.map((goal) => h('option', { key: goal.id, value: goal.id }, goal.name)),
      ),
    ),
    h(Field, { label: '截止时间' }, h(TextInput, { type: 'datetime-local', value: form.due_time, onChange: (event) => update('due_time', event.target.value) })),
    h(Field, { label: '预计耗时（分钟）' }, h(TextInput, { type: 'number', min: '0', value: form.estimated_minutes, onChange: (event) => update('estimated_minutes', event.target.value), placeholder: '60' })),
    h(
      Field,
      { label: '优先级' },
      h(
        Select,
        { value: form.priority, onChange: (event) => update('priority', event.target.value) },
        PRIORITY_OPTIONS.map((item) => h('option', { key: item.value, value: item.value }, item.label)),
      ),
    ),
    h(Field, { label: '备注', wide: true }, h(TextArea, { value: form.note, onChange: (event) => update('note', event.target.value), rows: compact ? 2 : 3, placeholder: '补充说明' })),
    h('div', { className: 'form-actions field-wide' }, h(Button, { type: 'submit' }, '创建任务')),
  );
}

function ScheduleForm({ goals, onSubmit }) {
  const start = roundToNextQuarter();
  const defaultForm = {
    title: '',
    goal_id: '',
    start_time: toDateTimeLocal(start),
    end_time: toDateTimeLocal(addMinutes(start, 60)),
    note: '',
    repeat_type: 'none',
    repeat_interval: '1',
    repeat_weekdays: [String(start.getDay())],
    repeat_until: dateKey(addMonths(start, 3)),
    repeat_month_day: String(start.getDate()),
    repeat_month_week: '1',
    repeat_month_weekday: String(start.getDay()),
  };
  const [form, setForm] = useState({
    ...defaultForm,
  });

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function toggleWeekday(value) {
    setForm((current) => {
      const exists = current.repeat_weekdays.includes(String(value));
      const nextDays = exists
        ? current.repeat_weekdays.filter((item) => item !== String(value))
        : [...current.repeat_weekdays, String(value)];
      return { ...current, repeat_weekdays: nextDays.length ? nextDays : [String(value)] };
    });
  }

  function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) return;
    onSubmit({ ...form, title: form.title.trim(), note: form.note.trim() || null });
    const nextStart = roundToNextQuarter();
    setForm({
      ...defaultForm,
      start_time: toDateTimeLocal(nextStart),
      end_time: toDateTimeLocal(addMinutes(nextStart, 60)),
      repeat_weekdays: [String(nextStart.getDay())],
      repeat_until: dateKey(addMonths(nextStart, 3)),
      repeat_month_day: String(nextStart.getDate()),
      repeat_month_weekday: String(nextStart.getDay()),
    });
  }

  return h(
    'form',
    { className: 'form-grid', onSubmit: submit },
    h(Field, { label: '日程名称' }, h(TextInput, { value: form.title, onChange: (event) => update('title', event.target.value), placeholder: '例如：晨练', required: true })),
    h(
      Field,
      { label: '所属目标' },
      h(
        Select,
        { value: form.goal_id, onChange: (event) => update('goal_id', event.target.value) },
        h('option', { value: '' }, '不绑定目标'),
        goals.map((goal) => h('option', { key: goal.id, value: goal.id }, goal.name)),
      ),
    ),
    h(Field, { label: '开始时间' }, h(TextInput, { type: 'datetime-local', value: form.start_time, onChange: (event) => update('start_time', event.target.value), required: true })),
    h(Field, { label: '结束时间' }, h(TextInput, { type: 'datetime-local', value: form.end_time, onChange: (event) => update('end_time', event.target.value), required: true })),
    h(
      Field,
      { label: '重复方式' },
      h(
        Select,
        { value: form.repeat_type, onChange: (event) => update('repeat_type', event.target.value) },
        h('option', { value: 'none' }, '不重复'),
        h('option', { value: 'weekly' }, '按周重复'),
        h('option', { value: 'monthly-date' }, '按每月几号'),
        h('option', { value: 'monthly-weekday' }, '按第几周周几'),
      ),
    ),
    form.repeat_type !== 'none'
      ? h(Field, { label: '重复到' }, h(TextInput, { type: 'date', value: form.repeat_until, onChange: (event) => update('repeat_until', event.target.value), required: true }))
      : null,
    form.repeat_type !== 'none'
      ? h(
          Field,
          { label: '间隔' },
          h(
            Select,
            { value: form.repeat_interval, onChange: (event) => update('repeat_interval', event.target.value) },
            [1, 2, 3, 4].map((value) => h('option', { key: value, value: String(value) }, form.repeat_type === 'weekly' ? `每 ${value} 周` : `每 ${value} 月`)),
          ),
        )
      : null,
    form.repeat_type === 'weekly'
      ? h(
          Field,
          { label: '重复星期', wide: true },
          h(
            'div',
            { className: 'weekday-row' },
            WEEKDAY_OPTIONS.map((item) =>
              h(
                'button',
                {
                  key: item.value,
                  type: 'button',
                  className: classNames('choice-chip', form.repeat_weekdays.includes(String(item.value)) && 'active'),
                  onClick: () => toggleWeekday(item.value),
                },
                item.label,
              ),
            ),
          ),
        )
      : null,
    form.repeat_type === 'monthly-date'
      ? h(Field, { label: '每月日期' }, h(TextInput, { type: 'number', min: '1', max: '31', value: form.repeat_month_day, onChange: (event) => update('repeat_month_day', event.target.value) }))
      : null,
    form.repeat_type === 'monthly-weekday'
      ? h(
          Field,
          { label: '第几周' },
          h(
            Select,
            { value: form.repeat_month_week, onChange: (event) => update('repeat_month_week', event.target.value) },
            [1, 2, 3, 4].map((value) => h('option', { key: value, value: String(value) }, `第 ${value} 周`)),
            h('option', { value: 'last' }, '最后一周'),
          ),
        )
      : null,
    form.repeat_type === 'monthly-weekday'
      ? h(
          Field,
          { label: '星期几' },
          h(
            Select,
            { value: form.repeat_month_weekday, onChange: (event) => update('repeat_month_weekday', event.target.value) },
            WEEKDAY_OPTIONS.map((item) => h('option', { key: item.value, value: String(item.value) }, item.label)),
          ),
        )
      : null,
    h(Field, { label: '备注', wide: true }, h(TextArea, { value: form.note, onChange: (event) => update('note', event.target.value), rows: 3 })),
    h('div', { className: 'form-actions field-wide' }, h(Button, { type: 'submit' }, '创建日程')),
  );
}

function TimeEntryForm({ goals, tasks, schedules, goalsById, selectedDate, onSubmit }) {
  const defaultStart = `${selectedDate}T09:00`;
  const defaultEnd = `${selectedDate}T10:00`;
  const [form, setForm] = useState({
    source_type: 'manual',
    source_id: '',
    title: '',
    goal_id: '',
    start_time: defaultStart,
    end_time: defaultEnd,
    note: '',
  });

  useEffect(() => {
    setForm((current) => ({ ...current, start_time: `${selectedDate}T09:00`, end_time: `${selectedDate}T10:00` }));
  }, [selectedDate]);

  function update(key, value) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      if (key === 'source_type') {
        next.source_id = '';
        next.title = '';
        next.goal_id = '';
      }
      if (key === 'source_id' && current.source_type === 'task') {
        const task = tasks.find((item) => item.id === value);
        next.title = task?.title || '';
        next.goal_id = task?.goal_id || '';
      }
      if (key === 'source_id' && current.source_type === 'schedule') {
        const schedule = schedules.find((item) => item.id === value);
        next.title = schedule?.title || '';
        next.goal_id = schedule?.goal_id || '';
      }
      return next;
    });
  }

  function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) return;
    onSubmit({ ...form, title: form.title.trim(), note: form.note.trim() || null });
    setForm({ source_type: 'manual', source_id: '', title: '', goal_id: '', start_time: defaultStart, end_time: defaultEnd, note: '' });
  }

  const sourceOptions = form.source_type === 'task' ? tasks : form.source_type === 'schedule' ? schedules : [];

  return h(
    'form',
    { className: 'form-grid', onSubmit: submit },
    h(
      Field,
      { label: '类型' },
      h(
        Select,
        { value: form.source_type, onChange: (event) => update('source_type', event.target.value) },
        h('option', { value: 'manual' }, '临时事项'),
        h('option', { value: 'task' }, '任务'),
        h('option', { value: 'schedule' }, '日程'),
      ),
    ),
    form.source_type !== 'manual'
      ? h(
          Field,
          { label: form.source_type === 'task' ? '选择任务' : '选择日程' },
          h(
            Select,
            { value: form.source_id, onChange: (event) => update('source_id', event.target.value) },
            h('option', { value: '' }, '请选择'),
            sourceOptions.map((item) => h('option', { key: item.id, value: item.id }, item.title)),
          ),
        )
      : null,
    h(Field, { label: '事项名称' }, h(TextInput, { value: form.title, onChange: (event) => update('title', event.target.value), placeholder: '例如：临时沟通', required: true })),
    h(
      Field,
      { label: '所属目标' },
      h(
        Select,
        { value: form.goal_id, onChange: (event) => update('goal_id', event.target.value) },
        h('option', { value: '' }, '不绑定目标'),
        goals.map((goal) => h('option', { key: goal.id, value: goal.id }, `${goal.name} · ${categoryMeta(goal.category).label}`)),
      ),
    ),
    h(Field, { label: '开始时间' }, h(TextInput, { type: 'datetime-local', value: form.start_time, onChange: (event) => update('start_time', event.target.value), required: true })),
    h(Field, { label: '结束时间' }, h(TextInput, { type: 'datetime-local', value: form.end_time, onChange: (event) => update('end_time', event.target.value), required: true })),
    h(Field, { label: '备注', wide: true }, h(TextArea, { value: form.note, onChange: (event) => update('note', event.target.value), rows: 3 })),
    h('div', { className: 'form-actions field-wide' }, h(Button, { type: 'submit' }, '保存时间记录')),
    form.goal_id ? h('p', { className: 'field-wide subtle-line' }, `将计入：${getGoalLabel(form.goal_id, goalsById)}`) : null,
  );
}

function TaskCard({ task, goalsById, segments, now, actions, busy }) {
  const goal = task.goal_id ? goalsById.get(task.goal_id) : null;
  const taskSegments = segments.filter((segment) => segment.source_type === 'task' && segment.source_id === task.id);
  const running = taskSegments.find((segment) => segment.is_running);
  const total = sumDurations(taskSegments, now);
  const priority = PRIORITY_OPTIONS.find((item) => item.value === task.priority)?.label || '中';
  const statusLabel = TASK_STATUS[task.status] || task.status;

  return h(
    'article',
    { className: classNames('task-card', task.status === 'completed' && 'completed') },
    h('div', { className: 'task-accent', style: { background: getGoalColor(task.goal_id, goalsById) } }),
    h(
      'div',
      { className: 'task-card-head' },
      h('div', null, h('p', { className: 'eyebrow' }, goal ? goal.name : '其他任务'), h('h3', null, task.title)),
      h('span', { className: classNames('status-pill', task.status) }, statusLabel),
    ),
    h(
      'div',
      { className: 'task-meta' },
      h('span', null, categoryMeta(goal?.category || task.category || 'other').label),
      h('span', null, `优先级 ${priority}`),
      task.due_time ? h('span', null, `截止 ${formatClock(task.due_time)}`) : null,
      task.estimated_minutes ? h('span', null, `预计 ${task.estimated_minutes} 分钟`) : null,
    ),
    h(
      'div',
      { className: 'duration-line' },
      h('span', null, '累计耗时'),
      h('strong', null, formatDuration(total, true)),
      running ? h('em', null, `本段 ${formatDuration(getSegmentDuration(running, now), true)}`) : null,
    ),
    task.note ? h('p', { className: 'muted task-note' }, task.note) : null,
    h(
      'div',
      { className: 'task-actions' },
      task.status === 'not_started' || task.status === 'paused'
        ? h(Button, { size: 'sm', onClick: () => actions.startTask(task), disabled: Boolean(busy) }, task.status === 'paused' ? '继续' : '开始')
        : null,
      task.status === 'running' ? h(Button, { size: 'sm', variant: 'secondary', onClick: () => actions.pauseTask(task), disabled: Boolean(busy) }, '暂停') : null,
      task.status !== 'completed' ? h(Button, { size: 'sm', variant: 'dark', onClick: () => actions.completeTask(task), disabled: Boolean(busy) }, '完成') : null,
    ),
  );
}

function ScheduleItem({ schedule, goalsById }) {
  const goal = schedule.goal_id ? goalsById.get(schedule.goal_id) : null;
  return h(
    'article',
    { className: 'schedule-item' },
    h('div', { className: 'schedule-dot', style: { background: getGoalColor(schedule.goal_id, goalsById) } }),
    h(
      'div',
      null,
      h('strong', null, schedule.title),
      h('span', null, `${formatClock(schedule.start_time)} - ${formatClock(schedule.end_time)} · ${goal?.name || '其他日程'}`),
      schedule.is_repeat ? h('span', { className: 'repeat-label' }, schedule.repeat_rule?.summary || '重复日程') : null,
    ),
    h('em', null, formatDuration(secondsBetween(schedule.start_time, schedule.end_time), true)),
  );
}

function Timeline({ segments, goalsById, onEdit, compact = false, onMoveSchedule }) {
  const { segments: laneSegments, laneCount } = assignTimelineLanes(segments);
  const height = compact ? 760 : 1200;
  const hourRows = Array.from({ length: 25 }, (_, index) => index);
  const stageWidth = Math.max(560, laneCount * 190);
  const stageRef = useRef(null);
  const dragRef = useRef(null);
  const suppressClickRef = useRef(false);
  const [dragPreview, setDragPreview] = useState(null);

  useEffect(() => {
    function updateDrag(event, finish = false) {
      const drag = dragRef.current;
      const stage = stageRef.current;
      if (!drag || !stage) return;
      const rect = stage.getBoundingClientRect();
      const y = clamp(event.clientY - rect.top, 0, rect.height - 1);
      const snappedMinute = roundToSnap((y / height) * 1440);
      const nextStart = new Date(drag.dayStart);
      nextStart.setHours(Math.floor(snappedMinute / 60), snappedMinute % 60, 0, 0);
      const nextEnd = new Date(nextStart.getTime() + drag.durationMs);
      const moved = Math.abs(event.clientY - drag.originY) > 4;
      setDragPreview({ id: drag.segment.id, top: (snappedMinute / 1440) * height, moved });
      if (finish) {
        dragRef.current = null;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 80);
        if (moved && onMoveSchedule) {
          suppressClickRef.current = true;
          onMoveSchedule(drag.segment, nextStart.toISOString(), nextEnd.toISOString());
        }
        setDragPreview(null);
      }
    }

    function handlePointerMove(event) {
      if (!dragRef.current) return;
      event.preventDefault();
      updateDrag(event);
    }

    function handlePointerUp(event) {
      if (!dragRef.current) return;
      event.preventDefault();
      updateDrag(event, true);
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [height, onMoveSchedule]);

  function startScheduleDrag(event, segment) {
    if (!onMoveSchedule || segment.source_type !== 'schedule' || event.button !== 0) return;
    dragRef.current = {
      segment,
      dayStart: new Date(segment.clampedStart.getFullYear(), segment.clampedStart.getMonth(), segment.clampedStart.getDate()),
      durationMs: Math.max(15 * 60000, new Date(segment.end_time) - new Date(segment.start_time)),
      originY: event.clientY,
    };
  }

  if (!segments.length) return h(EmptyState, { title: '这一天还没有时间记录', copy: '开始任务、创建日程或手动补录后，时间块会出现在这里。' });

  return h(
    'div',
    { className: classNames('timeline-wrap', compact && 'timeline-compact'), style: { '--timeline-height': `${height}px` } },
    h(
      'div',
      { className: 'timeline-hours' },
      hourRows.map((hour) => h('span', { key: hour, style: { top: `${(hour / 24) * height}px` } }, `${String(hour).padStart(2, '0')}:00`)),
    ),
    h(
      'div',
      { className: 'timeline-stage', ref: stageRef, style: { minWidth: `${stageWidth}px` } },
      hourRows.map((hour) => h('div', { key: hour, className: 'hour-line', style: { top: `${(hour / 24) * height}px` } })),
      laneSegments.map((segment) => {
        const top = (segment.startMinute / 1440) * height;
        const blockHeight = Math.max(34, (segment.clampedDuration / 86400) * height);
        const preview = dragPreview?.id === segment.id ? dragPreview : null;
        const tipDown = (preview ? preview.top : top) < 140;
        const width = 100 / laneCount;
        const left = segment.lane * width;
        const detail = [
          segment.title,
          `${formatClock(segment.clampedStart)} - ${formatClock(segment.clampedEnd)}`,
          `${getSourceLabel(segment.source_type)} · ${formatDuration(segment.clampedDuration, true)}`,
          segment.note,
        ]
          .filter(Boolean)
          .join('\n');
        return h(
          'button',
          {
            key: segment.id,
            type: 'button',
            className: classNames('timeline-block', blockHeight < 58 && 'is-tight', tipDown && 'tip-down', onEdit && 'editable', onMoveSchedule && segment.source_type === 'schedule' && 'draggable', preview && 'dragging'),
            style: {
              top: `${preview ? preview.top : top}px`,
              height: `${blockHeight}px`,
              left: `calc(${left}% + 4px)`,
              width: `calc(${width}% - 8px)`,
              '--block-color': getGoalColor(segment.goal_id, goalsById),
            },
            onPointerDown: (event) => startScheduleDrag(event, segment),
            onClick: onEdit ? () => {
              if (suppressClickRef.current) return;
              onEdit(segment);
            } : undefined,
            title: detail,
          },
          h('span', { className: 'timeline-kind' }, getSourceLabel(segment.source_type)),
          h('strong', null, segment.title),
          h(
            'span',
            { className: 'timeline-tip' },
            h('b', null, segment.title),
            h('small', null, `${formatClock(segment.clampedStart)} - ${formatClock(segment.clampedEnd)} · ${getSourceLabel(segment.source_type)} · ${formatDuration(segment.clampedDuration, true)}`),
            segment.note ? h('small', null, segment.note) : null,
          ),
        );
      }),
    ),
  );
}

function ScheduleEditorModal({ schedule, goals, goalsById, onClose, onSubmit, onDelete }) {
  const [form, setForm] = useState({
    title: schedule.title,
    goal_id: schedule.goal_id || '',
    start_time: toDateTimeLocal(schedule.start_time),
    end_time: toDateTimeLocal(schedule.end_time),
    note: schedule.note || '',
  });

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    if (!form.title.trim()) return;
    onSubmit({ ...form, title: form.title.trim(), note: form.note.trim() || null });
  }

  return h(
    'div',
    { className: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true' },
    h(
      'form',
      { className: 'modal-card panel schedule-editor-modal', onSubmit: submit },
      h(SectionTitle, { eyebrow: 'Edit Schedule', title: '修改日程' }),
      h(Field, { label: '日程名称' }, h(TextInput, { value: form.title, onChange: (event) => update('title', event.target.value), required: true })),
      h(
        Field,
        { label: '所属目标' },
        h(
          Select,
          { value: form.goal_id, onChange: (event) => update('goal_id', event.target.value) },
          h('option', { value: '' }, '不绑定目标'),
          goals.map((goal) => h('option', { key: goal.id, value: goal.id }, `${goal.name} · ${categoryMeta(goal.category).label}`)),
        ),
      ),
      h(Field, { label: '开始时间' }, h(TextInput, { type: 'datetime-local', value: form.start_time, onChange: (event) => update('start_time', event.target.value), required: true })),
      h(Field, { label: '结束时间' }, h(TextInput, { type: 'datetime-local', value: form.end_time, onChange: (event) => update('end_time', event.target.value), required: true })),
      h(Field, { label: '备注', wide: true }, h(TextArea, { value: form.note, onChange: (event) => update('note', event.target.value), rows: 3 })),
      form.goal_id ? h('p', { className: 'subtle-line field-wide' }, `将计入：${getGoalLabel(form.goal_id, goalsById)}`) : null,
      schedule.is_repeat ? h('p', { className: 'subtle-line field-wide' }, '这是重复日程中的一个实例，修改或删除只影响当前这条。') : null,
      h(
        'div',
        { className: 'modal-actions field-wide' },
        h(Button, { type: 'submit' }, '保存修改'),
        h(Button, { variant: 'danger', onClick: onDelete }, '删除日程'),
        h(Button, { variant: 'ghost', onClick: onClose }, '取消'),
      ),
    ),
  );
}

function SegmentEditorModal({ segment, goals, goalsById, onClose, onSubmit, onDelete }) {
  const [form, setForm] = useState({
    title: segment.title,
    goal_id: segment.goal_id || '',
    start_time: toDateTimeLocal(segment.start_time),
    end_time: toDateTimeLocal(segment.end_time || new Date()),
    note: segment.note || '',
  });

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    onSubmit({ ...form, title: form.title.trim(), note: form.note.trim() || null });
  }

  return h(
    'div',
    { className: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true' },
    h(
      'form',
      { className: 'modal-card panel', onSubmit: submit },
      h(SectionTitle, { eyebrow: 'Edit Segment', title: '修改时间记录' }),
      h(Field, { label: '事项名称' }, h(TextInput, { value: form.title, onChange: (event) => update('title', event.target.value), required: true })),
      h(
        Field,
        { label: '所属目标' },
        h(
          Select,
          { value: form.goal_id, onChange: (event) => update('goal_id', event.target.value) },
          h('option', { value: '' }, '不绑定目标'),
          goals.map((goal) => h('option', { key: goal.id, value: goal.id }, `${goal.name} · ${categoryMeta(goal.category).label}`)),
        ),
      ),
      h(Field, { label: '开始时间' }, h(TextInput, { type: 'datetime-local', value: form.start_time, onChange: (event) => update('start_time', event.target.value), required: true })),
      h(Field, { label: '结束时间' }, h(TextInput, { type: 'datetime-local', value: form.end_time, onChange: (event) => update('end_time', event.target.value), required: true })),
      h(Field, { label: '备注' }, h(TextArea, { value: form.note, onChange: (event) => update('note', event.target.value), rows: 3 })),
      form.goal_id ? h('p', { className: 'subtle-line' }, `将计入：${getGoalLabel(form.goal_id, goalsById)}`) : null,
      h(
        'div',
        { className: 'modal-actions' },
        h(Button, { type: 'submit' }, '保存修改'),
        h(Button, { variant: 'danger', onClick: onDelete }, '删除记录'),
        h(Button, { variant: 'ghost', onClick: onClose }, '取消'),
      ),
    ),
  );
}

function DonutPanel({ eyebrow, title, parts }) {
  const total = parts.reduce((sum, part) => sum + part.seconds, 0);
  return h(
    'article',
    { className: 'panel chart-panel' },
    h(SectionTitle, { eyebrow, title }),
    total
      ? h(
          'div',
          { className: 'donut-layout' },
          h('div', { className: 'donut', style: { background: conicGradient(parts) } }, h('span', null, formatDuration(total, true))),
          h(
            'div',
            { className: 'legend' },
            parts.map((part) =>
              h(
                'div',
                { key: part.key, className: 'legend-row' },
                h('i', { style: { background: part.color } }),
                h('span', null, part.label),
                h('strong', null, formatDuration(part.seconds, true)),
              ),
            ),
          ),
        )
      : h(EmptyState, { title: '暂无数据', copy: '今天还没有可统计的时间记录。' }),
  );
}

function BarPanel({ eyebrow, title, items, valueLabel }) {
  const max = Math.max(1, ...items.map((item) => item.seconds));
  return h(
    'article',
    { className: 'panel chart-panel' },
    h(SectionTitle, { eyebrow, title }),
    items.length
      ? h(
          'div',
          { className: 'bar-list' },
          items.slice(0, 6).map((item) =>
            h(
              'div',
              { key: item.key, className: 'bar-row' },
              h('div', { className: 'bar-label' }, h('span', null, item.label), h('strong', null, valueLabel(item))),
              h('div', { className: 'bar-track' }, h('i', { style: { width: `${Math.max(6, (item.seconds / max) * 100)}%`, background: item.color } })),
            ),
          ),
        )
      : h(EmptyState, { title: '暂无排行', copy: '完成任务计时后会生成排行。' }),
  );
}

function FocusPanel({ eyebrow, title, buckets }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return h(
    'article',
    { className: 'panel chart-panel' },
    h(SectionTitle, { eyebrow, title }),
    h(
      'div',
      { className: 'focus-bars' },
      buckets.map((bucket, index) =>
        h(
          'div',
          { key: bucket.key, className: 'focus-bucket' },
          h('div', { className: 'focus-bar', style: { height: `${Math.max(8, (bucket.count / max) * 150)}px`, background: BRAND_COLORS[index] } }),
          h('strong', null, bucket.count),
          h('span', null, bucket.label),
        ),
      ),
    ),
  );
}

function ReviewForm({ journal, review, onSubmit }) {
  const [form, setForm] = useState(() =>
    JOURNAL_FIELDS.reduce((acc, field) => ({ ...acc, [field.key]: journal?.[field.key] || '' }), {}),
  );
  const [summary, setSummary] = useState(review?.summary || '');

  useEffect(() => {
    setForm(JOURNAL_FIELDS.reduce((acc, field) => ({ ...acc, [field.key]: journal?.[field.key] || '' }), {}));
    setSummary(review?.summary || '');
  }, [journal, review]);

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event) {
    event.preventDefault();
    onSubmit(form, summary);
  }

  return h(
    'form',
    { className: 'journal-form', onSubmit: submit },
    JOURNAL_FIELDS.map((field) =>
      field.key === 'emotion_feeling'
        ? h(EmotionPicker, {
            key: field.key,
            label: field.label,
            value: form[field.key] || '',
            onChange: (value) => update(field.key, value),
          })
        : h(Field, { key: field.key, label: field.label }, h(TextArea, { value: form[field.key] || '', onChange: (event) => update(field.key, event.target.value), rows: 3, placeholder: '写下真实发生的事，不需要修饰。' })),
    ),
    h(Field, { label: '今日复盘总结' }, h(TextArea, { value: summary, onChange: (event) => setSummary(event.target.value), rows: 4, placeholder: '今天我看见了什么？明天要校准什么？' })),
    h('div', { className: 'form-actions' }, h(Button, { type: 'submit' }, '保存每日复盘')),
  );
}

function EmotionPicker({ label, value, onChange }) {
  return h(
    'div',
    { className: 'field field-wide emotion-picker-field' },
    h('span', { className: 'field-label' }, label),
    h(
      'div',
      { className: 'emotion-picker' },
      EMOTION_LEVELS.map((emotion) =>
        h(
          'button',
          {
            key: emotion.value,
            type: 'button',
            className: classNames('emotion-option', value === emotion.value && 'selected'),
            style: { '--emotion-color': emotion.color },
            onClick: () => onChange(emotion.value),
            'aria-pressed': value === emotion.value,
            'aria-label': emotion.label,
            title: emotion.label,
          },
          h('span', null, emotion.icon),
        ),
      ),
    ),
    h('small', { className: 'field-hint' }, '每天选择一个最接近的状态，后续会形成情绪变化轨迹。'),
  );
}

function buildDayAnalysis(data, selectedDate, now, goalsById) {
  const daySegments = segmentsForDate(data.segments, selectedDate, now);
  const totalSegmentSeconds = daySegments.reduce((sum, segment) => sum + segment.clampedDuration, 0);
  const naturalSeconds = unionDurationSeconds(daySegments);
  const taskSeconds = daySegments
    .filter((segment) => segment.source_type === 'task')
    .reduce((sum, segment) => sum + segment.clampedDuration, 0);
  const targetSeconds = daySegments.filter((segment) => segment.goal_id).reduce((sum, segment) => sum + segment.clampedDuration, 0);
  const nonTargetSeconds = daySegments.filter((segment) => !segment.goal_id).reduce((sum, segment) => sum + segment.clampedDuration, 0);
  const overlapSeconds = Math.max(0, totalSegmentSeconds - naturalSeconds);
  const longestSeconds = Math.max(0, ...daySegments.map((segment) => segment.clampedDuration));
  const fragmentCount = daySegments.length;
  const completedTaskCount = data.tasks.filter((task) => task.status === 'completed' && task.completed_at && isSameLocalDate(task.completed_at, selectedDate)).length;
  const journal = data.journals.find((item) => item.review_date === selectedDate);
  const review = data.reviews.find(
    (item) => item.review_type === 'day' && item.period_start === selectedDate && item.period_end === selectedDate,
  );

  const goalParts = buildDistribution(
    daySegments,
    (segment) => segment.goal_id || 'none',
    (segment) => getGoalLabel(segment.goal_id, goalsById),
    (segment) => getGoalColor(segment.goal_id, goalsById),
    (segment) => segment.clampedDuration,
  );

  const categoryParts = buildDistribution(
    daySegments,
    (segment) => segment.category || 'other',
    (segment) => categoryMeta(segment.category || 'other').label,
    (segment) => categoryMeta(segment.category || 'other').color,
    (segment) => segment.clampedDuration,
  );

  const taskRanking = buildDistribution(
    daySegments.filter((segment) => segment.source_type === 'task'),
    (segment) => segment.source_id || segment.id,
    (segment) => segment.title,
    (segment) => getGoalColor(segment.goal_id, goalsById),
    (segment) => segment.clampedDuration,
  );

  return {
    goalsById,
    daySegments,
    naturalSeconds,
    taskSeconds,
    targetSeconds,
    nonTargetSeconds,
    overlapSeconds,
    longestSeconds,
    fragmentCount,
    completedTaskCount,
    reviewDone: hasReviewContent(journal, review),
    goalParts,
    categoryParts,
    taskRanking,
    focusBuckets: focusBuckets(daySegments),
  };
}

createRoot(document.getElementById('root')).render(h(App));
