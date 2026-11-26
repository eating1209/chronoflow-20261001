import type { EventOccurrence, Task } from '../../../shared/api';

/**
 * 把 ISO 时间转成指定时区的 `YYYY-MM-DD`。
 *
 * 返回空串表示时间字段不可用。服务端历史数据里可能有一条损坏的时间，
 * 不能让 `Intl.formatToParts` 的 RangeError 把整张日历（连同 App）打崩。
 */
export function localDateKey(iso: string | null | undefined, timeZone: string): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    // 时区字符串本身非法（例如历史数据里的空时区）时同样降级为空日期
    return '';
  }
}

export interface AgendaSection<T> {
  date: string;
  items: T[];
}

/** 日历当天列表里的一行：日程与带截止时间的待办共用同一条时间轴。 */
export type DayAgendaItem =
  | { kind: 'event'; at: string; event: EventOccurrence }
  | { kind: 'task'; at: string; task: Task };

/** 按本地日期分组，并保持每组内按时间升序。 */
export function groupByDay<T>(
  items: T[],
  getStart: (item: T) => string,
  timeZone: string,
): AgendaSection<T>[] {
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const key = localDateKey(getStart(item), timeZone);
    if (!key) {
      continue;
    }
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(key, [item]);
    }
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, group]) => ({
      date,
      items: [...group].sort((a, b) => getStart(a).localeCompare(getStart(b))),
    }));
}

export function groupOccurrences(items: EventOccurrence[], timeZone: string) {
  return groupByDay(items, (item) => item.at, timeZone);
}

/**
 * 某一天的日历条目。
 *
 * 只收有截止时间的待办；没有时间的待办留在待办页的「待安排」，
 * 放进日历会让用户误以为它在某个时刻发生。已完成待办当天仍保留，
 * 方便回看「今天做完了什么」；跨到别的日期就不再出现。
 */
export function agendaItemsForDay(
  occurrences: EventOccurrence[],
  tasks: Task[],
  dateKey: string,
  timeZone: string,
): DayAgendaItem[] {
  const events: DayAgendaItem[] = occurrences
    .filter((item) => localDateKey(item.at, timeZone) === dateKey)
    .map((event) => ({ kind: 'event', at: event.at, event }));
  const taskItems: DayAgendaItem[] = tasks
    .filter(
      (task) =>
        task.dueAt !== null &&
        task.status !== 'CANCELLED' &&
        localDateKey(task.dueAt, timeZone) === dateKey,
    )
    .map((task) => ({ kind: 'task', at: task.dueAt as string, task }));

  return [...events, ...taskItems].sort((left, right) => {
    const byTime = left.at.localeCompare(right.at);
    if (byTime !== 0) {
      return byTime;
    }
    // 同一时刻先显示日程，再显示待办截止；类型顺序必须稳定，避免每帧跳动。
    return left.kind === right.kind ? 0 : left.kind === 'event' ? -1 : 1;
  });
}

/** 月历上需要标记的日期：日程发生日 + 有待办截止的日期。 */
export function agendaDateKeys(
  occurrences: EventOccurrence[],
  tasks: Task[],
  timeZone: string,
): Set<string> {
  const keys = new Set<string>();
  for (const item of occurrences) {
    const key = localDateKey(item.at, timeZone);
    if (key) {
      keys.add(key);
    }
  }
  for (const task of tasks) {
    if (task.dueAt !== null && task.status !== 'CANCELLED') {
      const key = localDateKey(task.dueAt, timeZone);
      if (key) {
        keys.add(key);
      }
    }
  }
  return keys;
}

/** 相对日期标签：今天 / 明天 / 昨天 / 周几 / 具体日期。 */
export function formatDayLabel(dateKey: string, todayKey: string): string {
  const diff = daysBetween(todayKey, dateKey);
  if (diff === 0) {
    return '今天';
  }
  if (diff === 1) {
    return '明天';
  }
  if (diff === -1) {
    return '昨天';
  }
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getUTCDay()];
  return Math.abs(diff) < 7 ? `${weekday}` : `${month} 月 ${day} 日`;
}

export function daysBetween(fromKey: string, toKey: string): number {
  const toUtc = (key: string) => {
    const [year, month, day] = key.split('-').map(Number) as [number, number, number];
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((toUtc(toKey) - toUtc(fromKey)) / 86_400_000);
}

const WEEKDAY_FULL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * 当日标题：`今天 · 9 月 25 日 周五`。
 *
 * 日历页与组织页共用同一份实现——两个 tab 的骨架都是「月历 + 当日日程」，
 * 标题口径不一致会让来回切换时产生割裂感。
 */
export function dayHeading(dateKey: string, todayKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAY_FULL[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const prefix = dateKey === todayKey ? '今天 · ' : '';
  return `${prefix}${month} 月 ${day} 日 ${weekday}`;
}

/**
 * 这个时刻是不是「只有日期、没有时刻」。
 *
 * <p>**这只是识别结果里的一个信号，不是展示口径**（2026-10-01 改）：
 * 日程只有一个时间点（spec §4.1.2），**00:00 就是一个普通的时间点，不再代表「全天 / 只说了哪天」**。
 * 会用到它的地方只有一处——图片识别的解析结果：模型按提示词的约定，把「只写了哪一天」
 * 输出成当地 00:00，客户端据此判断「时刻没识别出来」，填一个默认时刻并在备注里标注。
 */
export function isDateOnlyPoint(atIso: string, timeZone: string): boolean {
  const date = new Date(atIso);
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  try {
    return formatter.format(date) === '00:00';
  } catch {
    return false;
  }
}

/**
 * 日程时间的展示：永远是「HH:mm」，**00:00 也照实显示**。
 *
 * <p>以前这里对当地 00:00 返回 null（「只说了哪一天」→ 只显示日期），结果是用户
 * 把时间拨到 00:00 之后，列表里那一栏干脆空了——看起来就是「00:00 选不上」。
 * 现在时间点必须明确，00:00 就是凌晨零点。
 */
export function formatEventTime(atIso: string, timeZone: string): string {
  return timeInZoneByIntl(atIso, timeZone);
}

/** 日程的结束时刻；旧数据没有时长时按 60 分钟补一个可读的区间。 */
export function eventEndAt(event: Pick<EventOccurrence, 'at' | 'durationMinutes'>): string {
  const start = Date.parse(event.at);
  const minutes = event.durationMinutes && event.durationMinutes > 0 ? event.durationMinutes : 60;
  if (!Number.isFinite(start)) {
    return event.at;
  }
  return new Date(start + minutes * 60_000).toISOString();
}

/** 日历列表里展示的时间：`09:00–10:00`。 */
export function formatEventTimeRange(
  event: Pick<EventOccurrence, 'at' | 'durationMinutes'>,
  timeZone: string,
): string {
  return `${formatEventTime(event.at, timeZone)}–${formatEventTime(eventEndAt(event), timeZone)}`;
}

/**
 * 「什么时候的事」整串文案：`9 月 30 日 15:00`（通知正文用）。
 */
export function formatEventWhen(atIso: string, timeZone: string): string {
  const dateKey = localDateKey(atIso, timeZone);
  if (!dateKey) {
    return '时间未知';
  }
  const [, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  return `${month} 月 ${day} 日 ${formatEventTime(atIso, timeZone)}`;
}

function timeInZoneByIntl(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(date);
  } catch {
    return '--:--';
  }
}

/**
 * 地点展示文案（spec §5.9）：地图给的地点可能只到「教学楼」，
 * 用户手填的详细地址是它的补充；两者都可空。
 */
export function locationLabel(name: string | null, detail: string | null): string {
  const place = (name ?? '').trim();
  const extra = (detail ?? '').trim();
  if (place && extra) {
    return `${place}（${extra}）`;
  }
  return place || extra;
}

export function sortTasks(tasks: Task[]): Task[] {
  const priorityRank: Record<Task['priority'], number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
  return [...tasks].sort((a, b) => {
    const doneA = a.status === 'DONE' ? 1 : 0;
    const doneB = b.status === 'DONE' ? 1 : 0;
    if (doneA !== doneB) {
      return doneA - doneB;
    }
    if (a.dueAt && b.dueAt) {
      return a.dueAt.localeCompare(b.dueAt);
    }
    if (a.dueAt) {
      return -1;
    }
    if (b.dueAt) {
      return 1;
    }
    return priorityRank[a.priority] - priorityRank[b.priority];
  });
}
