import type { EventOccurrence, Task } from '../../../shared/api';
import { APP_TIMEZONE, daysBetween, localDateKey } from '../../calendar/pure';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/** 红色：未来 48 小时内（含边界）。 */
export const TASK_URGENT_WINDOW_MS = 48 * HOUR_MS;
/** 橙色：48 小时后到一周内（含边界）。 */
export const TASK_SOON_WINDOW_MS = 7 * DAY_MS;

export const TASK_URGENCY_ORDER = ['urgent', 'soon', 'calm'] as const;

export type TaskUrgency = (typeof TASK_URGENCY_ORDER)[number];

/**
 * 任务条里的一格。
 *
 * 日程和待办共用同一套紧急度；`at` 是排序与分组用的时间点：
 * 待办取截止时间（可空），日程取发生时间（必填）。
 */
export type TaskOverviewEntry =
  | {
      key: string;
      kind: 'task';
      at: string | null;
      task: Task;
    }
  | {
      key: string;
      kind: 'event';
      at: string;
      event: EventOccurrence;
    };

export function taskOverviewEntry(task: Task): TaskOverviewEntry {
  return { key: `task:${task.id}`, kind: 'task', at: task.dueAt, task };
}

export function eventOverviewEntry(event: EventOccurrence): TaskOverviewEntry {
  return {
    key: `event:${event.eventId}:${event.occurrenceDate ?? event.at}`,
    kind: 'event',
    at: event.at,
    event,
  };
}

/**
 * 行内详情到底有没有内容可展开。
 *
 * 任务只要挂了日程就允许展开：关联日程的地点、备注要展开后才查，
 * 不能因为列表里暂时没带这些字段就把箭头藏掉。
 */
export function overviewEntryHasDetails(entry: TaskOverviewEntry): boolean {
  if (entry.kind === 'event') {
    return Boolean(
      entry.event.description?.trim() ||
        entry.event.locationName?.trim() ||
        entry.event.locationDetail?.trim(),
    );
  }
  return Boolean(
    entry.task.description?.trim() ||
      entry.task.locationName?.trim() ||
      entry.task.locationDetail?.trim() ||
      entry.task.eventTitle ||
      entry.task.eventId !== null,
  );
}

/**
 * 任务条的紧急度分组。
 *
 * 与任务优先级无关：这里表达的是「离截止还有多久」。
 * 红色是未来 48 小时内，橙色是 48 小时到一周，绿色是一周后或待安排。
 * 已过期不再进入三色分组（但仍保留在 App 的待办列表里）。
 */
export function taskUrgency(
  task: Pick<Task, 'dueAt'>,
  now: number = Date.now(),
): TaskUrgency {
  return urgencyForAt(task.dueAt, now);
}

export function urgencyForAt(at: string | null, now: number = Date.now()): TaskUrgency {
  if (!at) {
    return 'calm';
  }
  const due = Date.parse(at);
  if (!Number.isFinite(due)) {
    return 'calm';
  }
  const remaining = due - now;
  if (remaining < 0) {
    return 'calm';
  }
  if (remaining <= TASK_URGENT_WINDOW_MS) {
    return 'urgent';
  }
  if (remaining <= TASK_SOON_WINDOW_MS) {
    return 'soon';
  }
  return 'calm';
}

/** 已过期的安排不再出现在任务条的三色分组里。 */
export function isOverdueAt(at: string | null, now: number = Date.now()): boolean {
  if (!at) {
    return false;
  }
  const due = Date.parse(at);
  return Number.isFinite(due) && due < now;
}

export function groupTaskOverviewByUrgency(
  entries: TaskOverviewEntry[],
  now: number = Date.now(),
): Record<TaskUrgency, TaskOverviewEntry[]> {
  const groups: Record<TaskUrgency, TaskOverviewEntry[]> = {
    urgent: [],
    soon: [],
    calm: [],
  };
  for (const entry of entries) {
    if (isOverdueAt(entry.at, now)) {
      continue;
    }
    groups[urgencyForAt(entry.at, now)].push(entry);
  }
  for (const bucket of TASK_URGENCY_ORDER) {
    groups[bucket].sort((a, b) => {
      const aTime = a.at ? Date.parse(a.at) : Number.POSITIVE_INFINITY;
      const bTime = b.at ? Date.parse(b.at) : Number.POSITIVE_INFINITY;
      return aTime - bTime;
    });
  }
  return groups;
}

export function groupTasksByUrgency(
  tasks: Task[],
  now: number = Date.now(),
): Record<TaskUrgency, Task[]> {
  const groups: Record<TaskUrgency, Task[]> = {
    urgent: [],
    soon: [],
    calm: [],
  };
  for (const task of tasks) {
    if (task.status !== 'TODO') {
      continue;
    }
    if (isOverdueAt(task.dueAt, now)) {
      continue;
    }
    groups[taskUrgency(task, now)].push(task);
  }
  return groups;
}

/** 截止时间的相对文案：今天 / 明天 / 昨天 / 具体日期，统一使用项目时区。 */
export function formatTaskDue(
  dueAt: string | null,
  now: number = Date.now(),
  timeZone: string = APP_TIMEZONE,
): string {
  if (!dueAt) {
    return '待安排';
  }
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) {
    return '待安排';
  }

  const todayKey = localDateKey(new Date(now).toISOString(), timeZone);
  const dueKey = localDateKey(dueAt, timeZone);
  const dayDiff = daysBetween(todayKey, dueKey);
  const time = new Intl.DateTimeFormat('zh-CN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(due);

  if (dayDiff === 0) {
    return `今天 ${time}`;
  }
  if (dayDiff === 1) {
    return `明天 ${time}`;
  }
  if (dayDiff === -1) {
    return `昨天 ${time}`;
  }

  const [, month, day] = dueKey.split('-').map(Number) as [number, number, number];
  return `${month}月${day}日 ${time}`;
}

export interface TaskOverviewDateGroup {
  dateKey: string;
  entries: TaskOverviewEntry[];
}

export interface TaskOverviewMonthGroup {
  monthKey: string;
  year: number;
  month: number;
  entries: TaskOverviewEntry[];
  dates: TaskOverviewDateGroup[];
}

/**
 * 待办页的三段式布局：已逾期、按月排期的未来安排、最后是无截止时间的待安排。
 *
 * 待安排必须单独留在最底下，不能混进「从容」或某个月份：
 * 它表达的是「还没决定什么时候做」，和「某天的安排」不是同一种信息。
 */
export interface TaskOverviewLayout {
  overdue: TaskOverviewEntry[];
  months: TaskOverviewMonthGroup[];
  unscheduled: TaskOverviewEntry[];
}

export interface TaskDateSectionLabel {
  primary: string;
  secondary: string;
  isToday: boolean;
}

const WEEKDAY_SHORT = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const PRIORITY_RANK: Record<Task['priority'], number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2,
  LOW: 3,
};

function validEntryTime(entry: TaskOverviewEntry): number | null {
  if (entry.at === null) {
    return null;
  }
  const time = Date.parse(entry.at);
  return Number.isFinite(time) ? time : null;
}

function compareOverviewEntries(left: TaskOverviewEntry, right: TaskOverviewEntry): number {
  const leftTime = validEntryTime(left) ?? Number.POSITIVE_INFINITY;
  const rightTime = validEntryTime(right) ?? Number.POSITIVE_INFINITY;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  // 同一时刻先日程、后待办截止；最后用 key 兜底，避免刷新时顺序跳动。
  if (left.kind !== right.kind) {
    return left.kind === 'event' ? -1 : 1;
  }
  return left.key.localeCompare(right.key);
}

function compareUnscheduled(left: TaskOverviewEntry, right: TaskOverviewEntry): number {
  const leftTask = left.kind === 'task' ? left.task : null;
  const rightTask = right.kind === 'task' ? right.task : null;
  if (!leftTask || !rightTask) {
    return left.key.localeCompare(right.key);
  }
  const byPriority = PRIORITY_RANK[leftTask.priority] - PRIORITY_RANK[rightTask.priority];
  if (byPriority !== 0) {
    return byPriority;
  }
  if (leftTask.sortOrder !== rightTask.sortOrder) {
    return leftTask.sortOrder - rightTask.sortOrder;
  }
  return leftTask.title.localeCompare(rightTask.title, 'zh-CN');
}

/**
 * 把合并后的日程 / 待办按月份分组。
 *
 * - 截止时间早于当前时刻的条目单独进「已逾期」，不会被塞进今天；
 * - 没有截止时间、或时间无法解析的待办进「待安排」；
 * - 月份、日期、同一天内的条目都按时间升序，保证刷新后位置稳定。
 */
export function groupTaskOverviewByMonth(
  entries: TaskOverviewEntry[],
  now: number = Date.now(),
  timeZone: string = APP_TIMEZONE,
): TaskOverviewLayout {
  const overdue: TaskOverviewEntry[] = [];
  const unscheduled: TaskOverviewEntry[] = [];
  const monthBuckets = new Map<string, Map<string, TaskOverviewEntry[]>>();

  for (const entry of entries) {
    const time = validEntryTime(entry);
    if (time === null) {
      unscheduled.push(entry);
      continue;
    }
    if (time < now) {
      overdue.push(entry);
      continue;
    }
    const dateKey = localDateKey(entry.at as string, timeZone);
    const monthKey = dateKey.slice(0, 7);
    const dates = monthBuckets.get(monthKey) ?? new Map<string, TaskOverviewEntry[]>();
    const dateEntries = dates.get(dateKey) ?? [];
    dateEntries.push(entry);
    dates.set(dateKey, dateEntries);
    monthBuckets.set(monthKey, dates);
  }

  overdue.sort(compareOverviewEntries);
  unscheduled.sort(compareUnscheduled);

  const months = [...monthBuckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([monthKey, dates]) => {
      const dateGroups = [...dates.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([dateKey, dateEntries]) => ({
          dateKey,
          entries: [...dateEntries].sort(compareOverviewEntries),
        }));
      const [year, month] = monthKey.split('-').map(Number) as [number, number];
      return {
        monthKey,
        year,
        month,
        entries: dateGroups.flatMap((group) => group.entries),
        dates: dateGroups,
      };
    });

  return { overdue, months, unscheduled };
}

/** 日期栏的「今天 / 明天 / 11月3日」与副标题，统一按项目时区计算。 */
export function taskDateSectionLabel(
  dateKey: string,
  todayKey: string,
): TaskDateSectionLabel {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  const weekday = WEEKDAY_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? '';
  const diff = daysBetween(todayKey, dateKey);
  if (diff === 0) {
    return { primary: '今天', secondary: `${month}/${day}`, isToday: true };
  }
  if (diff === 1) {
    return { primary: '明天', secondary: `${month}/${day}`, isToday: false };
  }
  return { primary: `${month}月${day}日`, secondary: weekday, isToday: false };
}
