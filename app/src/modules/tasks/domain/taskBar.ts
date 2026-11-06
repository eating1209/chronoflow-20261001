import { APP_TIMEZONE, localDateKey, locationLabel } from '../../calendar/pure';
import {
  TASK_URGENCY_ORDER,
  formatTaskDue,
  groupTaskOverviewByUrgency,
  isOverdueAt,
  overviewEntryHasDetails,
  type TaskOverviewEntry,
  type TaskUrgency,
} from './taskOverview';

export const TASK_BAR_GROUP_LABEL: Record<TaskUrgency, string> = {
  urgent: '紧急',
  soon: '临近',
  calm: '从容',
};

export interface TaskBarGroup {
  key: TaskUrgency;
  label: string;
  count: number;
  firstTitle: string;
  firstWhen: string;
  /** 通知卡最多画三行；这里带前八条，完成一条后还能自动补出下一项。 */
  items: TaskBarItem[];
}

/** 原生 RemoteViews 的一行任务。 `at` 用于完成后本地重算「最近截止」。 */
export interface TaskBarItem {
  key: string;
  kind: 'task' | 'event';
  id: number;
  occurrenceDate: string | null;
  title: string;
  whenText: string;
  at: string | null;
  today: boolean;
  overdue: boolean;
  location: string;
  note: string;
  hasDetails: boolean;
}

/**
 * 原生通知需要的全部文案。
 *
 * 只放「一眼能扫完」的信息：总数、今天截止数、最近一项、每组数量与第一条。
 * 通知展开后也不跳 App —— 真正的任务详情仍在 App 内操作。
 */
export interface TaskBarPayload {
  total: number;
  todayCount: number;
  overdueCount: number;
  headline: string;
  nearestTitle: string;
  nearestWhen: string;
  groups: TaskBarGroup[];
}

function entryTitle(entry: TaskOverviewEntry): string {
  return entry.kind === 'task' ? entry.task.title : entry.event.title;
}

function entryWhen(
  entry: TaskOverviewEntry,
  now: number,
  timeZone: string,
): string {
  if (entry.kind === 'task') {
    return formatTaskDue(entry.task.dueAt, now, timeZone);
  }
  // 通知里优先给「今天 / 明天」这种能一眼判断的文案，和待办保持一致。
  return formatTaskDue(entry.event.at, now, timeZone);
}

function validTime(entry: TaskOverviewEntry): number | null {
  if (!entry.at) {
    return null;
  }
  const time = Date.parse(entry.at);
  return Number.isFinite(time) ? time : null;
}

function entryLocation(entry: TaskOverviewEntry): string {
  if (entry.kind === 'task') {
    return locationLabel(entry.task.locationName ?? null, entry.task.locationDetail ?? null);
  }
  return locationLabel(entry.event.locationName, entry.event.locationDetail);
}

function entryNote(entry: TaskOverviewEntry): string {
  const description = entry.kind === 'task' ? entry.task.description : entry.event.description;
  return description?.trim() ?? '';
}

function taskBarItem(
  entry: TaskOverviewEntry,
  now: number,
  timeZone: string,
  todayKey: string,
): TaskBarItem {
  const time = validTime(entry);
  return {
    key: entry.key,
    kind: entry.kind,
    id: entry.kind === 'task' ? entry.task.id : entry.event.eventId,
    occurrenceDate: entry.kind === 'event' ? entry.event.occurrenceDate : null,
    title: entryTitle(entry),
    whenText: entryWhen(entry, now, timeZone),
    at: entry.at,
    today: entry.at ? localDateKey(entry.at, timeZone) === todayKey : false,
    overdue: time !== null && time < now,
    location: entryLocation(entry),
    note: entryNote(entry),
    hasDetails: overviewEntryHasDetails(entry),
  };
}

/**
 * 把任务页已有的合并条目压成通知文案。
 *
 * 不在这里重新拉数据，也不改任务状态：页面传什么，通知就显示什么，
 * 这样勾选完成后通知能立刻和页面保持一致。
 */
export function buildTaskBarPayload(
  entries: TaskOverviewEntry[],
  now: number = Date.now(),
  timeZone: string = APP_TIMEZONE,
): TaskBarPayload {
  const todayKey = localDateKey(new Date(now).toISOString(), timeZone);
  // 逾期项留在 App 待办列表，但不挤进三色任务条和锁屏提醒。
  const visibleEntries = entries.filter((entry) => !isOverdueAt(entry.at, now));
  const groups = groupTaskOverviewByUrgency(visibleEntries, now);

  let todayCount = 0;
  let overdueCount = 0;
  let nearest: TaskOverviewEntry | null = null;
  let nearestTime = Number.POSITIVE_INFINITY;

  for (const entry of visibleEntries) {
    const time = validTime(entry);
    if (time === null) {
      continue;
    }
    if (localDateKey(entry.at, timeZone) === todayKey) {
      todayCount += 1;
    }
    // 逾期项已被过滤，这里只需保留未来的最近一项。
    if (time < nearestTime) {
      nearest = entry;
      nearestTime = time;
    }
  }

  if (!nearest) {
    nearest = visibleEntries.find((entry) => entry.at === null) ?? null;
  }

  const headline =
    visibleEntries.length === 0
      ? '今天没有待办安排'
      : todayCount > 0
        ? `${todayCount} 项任务今天截止`
        : `${visibleEntries.length} 项待办与日程`;

  return {
    total: visibleEntries.length,
    todayCount,
    overdueCount,
    headline,
    nearestTitle: nearest ? entryTitle(nearest) : '暂无待安排事项',
    nearestWhen: nearest ? entryWhen(nearest, now, timeZone) : '—',
    groups: TASK_URGENCY_ORDER.map((key) => {
      const bucket = groups[key];
      const first = bucket[0] ?? null;
      return {
        key,
        label: TASK_BAR_GROUP_LABEL[key],
        count: bucket.length,
        firstTitle: first ? entryTitle(first) : '暂无',
        firstWhen: first ? entryWhen(first, now, timeZone) : '',
        items: bucket
          .slice(0, 8)
          .map((entry) => taskBarItem(entry, now, timeZone, todayKey)),
      };
    }),
  };
}
