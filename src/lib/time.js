export function pad(number) {
  return String(number).padStart(2, '0');
}

export function dateKey(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function toDateTimeLocal(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function fromDateTimeLocal(value) {
  if (!value) return null;
  return new Date(value).toISOString();
}

export function startOfLocalDay(dayKey) {
  return new Date(`${dayKey}T00:00:00`);
}

export function endOfLocalDay(dayKey) {
  return new Date(`${dayKey}T23:59:59.999`);
}

export function secondsBetween(start, end) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  return Math.max(0, Math.round((endMs - startMs) / 1000));
}

export function formatDuration(totalSeconds = 0, compact = false) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (compact) {
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m`;
    return `${rest}s`;
  }
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  if (minutes > 0) return `${minutes} 分钟`;
  return `${rest} 秒`;
}

export function formatClock(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function isSameLocalDate(value, dayKey) {
  return dateKey(new Date(value)) === dayKey;
}

export function clampSegmentToDay(segment, dayKey, now = new Date()) {
  if (!segment?.start_time) return null;
  const dayStart = startOfLocalDay(dayKey);
  const dayEnd = endOfLocalDay(dayKey);
  const start = new Date(segment.start_time);
  const end = segment.end_time ? new Date(segment.end_time) : now;
  if (end < dayStart || start > dayEnd) return null;
  const clampedStart = start < dayStart ? dayStart : start;
  const clampedEnd = end > dayEnd ? dayEnd : end;
  const duration = secondsBetween(clampedStart, clampedEnd);
  if (duration <= 0) return null;
  return {
    ...segment,
    clampedStart,
    clampedEnd,
    clampedDuration: duration,
    startMinute: clampedStart.getHours() * 60 + clampedStart.getMinutes(),
    endMinute: clampedEnd.getHours() * 60 + clampedEnd.getMinutes(),
  };
}

export function segmentsForDate(segments, dayKey, now = new Date()) {
  return segments
    .map((segment) => clampSegmentToDay(segment, dayKey, now))
    .filter(Boolean)
    .sort((a, b) => a.clampedStart - b.clampedStart);
}

export function unionDurationSeconds(segments) {
  if (!segments.length) return 0;
  const ranges = segments
    .map((segment) => [segment.clampedStart.getTime(), segment.clampedEnd.getTime()])
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range[0] > last[1]) {
      merged.push([...range]);
    } else {
      last[1] = Math.max(last[1], range[1]);
    }
  }
  return Math.round(merged.reduce((sum, range) => sum + (range[1] - range[0]) / 1000, 0));
}

export function assignTimelineLanes(segments) {
  const lanes = [];
  const assigned = segments.map((segment) => {
    const laneIndex = lanes.findIndex((laneEnd) => laneEnd <= segment.clampedStart.getTime());
    const index = laneIndex === -1 ? lanes.length : laneIndex;
    lanes[index] = segment.clampedEnd.getTime();
    return { ...segment, lane: index };
  });
  return { segments: assigned, laneCount: Math.max(1, lanes.length) };
}

export function getSegmentDuration(segment, now = new Date()) {
  if (!segment?.start_time) return 0;
  if (segment.end_time) return segment.duration_seconds ?? secondsBetween(segment.start_time, segment.end_time);
  return secondsBetween(segment.start_time, now);
}

export function sumDurations(segments, now = new Date()) {
  return segments.reduce((sum, segment) => sum + getSegmentDuration(segment, now), 0);
}

export function buildDistribution(items, getKey, getLabel, getColor, getSeconds) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item) || 'none';
    const current = map.get(key) || {
      key,
      label: getLabel(item),
      color: getColor(item),
      seconds: 0,
    };
    current.seconds += getSeconds(item);
    map.set(key, current);
  }
  return [...map.values()].sort((a, b) => b.seconds - a.seconds);
}

export function conicGradient(parts, fallback = '#E8F7F7') {
  const total = parts.reduce((sum, part) => sum + part.seconds, 0);
  if (!total) return fallback;
  let cursor = 0;
  const stops = parts.map((part) => {
    const start = (cursor / total) * 100;
    cursor += part.seconds;
    const end = (cursor / total) * 100;
    return `${part.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}

export function focusBuckets(segments) {
  const buckets = [
    { key: '0-15', label: '0-15 分钟', count: 0 },
    { key: '15-30', label: '15-30 分钟', count: 0 },
    { key: '30-60', label: '30-60 分钟', count: 0 },
    { key: '60+', label: '60 分钟以上', count: 0 },
  ];
  for (const segment of segments) {
    const minutes = segment.clampedDuration / 60;
    if (minutes < 15) buckets[0].count += 1;
    else if (minutes < 30) buckets[1].count += 1;
    else if (minutes < 60) buckets[2].count += 1;
    else buckets[3].count += 1;
  }
  return buckets;
}
