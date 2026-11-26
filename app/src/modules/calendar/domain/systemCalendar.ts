import type { EventDetail, Task } from '../../../shared/api';
import { APP_TIMEZONE, APP_UTC_OFFSET } from './calendar';

/**
 * 系统日历单向导出的纯数据转换。
 *
 * 这里刻意不碰 React Native / 原生模块：导出内容长什么样、重复日程用 DTEND 还是
 * DURATION 这类规则可以单测；真正的 ContentResolver 写在
 * `plugins/taskbar-native/CalendarSyncModule.kt`。
 */

/** 写进系统日历时附加的来源说明，用户一眼能看出这条是谁写的。 */
export const SYSTEM_CALENDAR_SOURCE_NOTE = '来自时纪流';
export const SYSTEM_CALENDAR_TASK_DEFAULT_END_MS = 365 * 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

export interface SystemCalendarEvent {
  eventId: number;
  title: string;
  /** 绝对时刻（epoch 毫秒），系统日历按这个值落库 */
  startMillis: number;
  endMillis: number;
  /** 全天事件：待办只表达“哪一天要做完”，不占用具体时段 */
  allDay: boolean;
  timezone: string;
  /** RFC 5545 重复规则；空串表示不重复 */
  rrule: string;
  description: string;
  locationName: string;
  locationDetail: string;
  locationAddress: string;
}

/** 把服务端的日程详情转成原生模块要的字段；时间坏掉的条目直接跳过。 */
export function buildSystemCalendarEvent(detail: EventDetail): SystemCalendarEvent {
  const startMillis = Date.parse(detail.at);
  if (!Number.isFinite(startMillis)) {
    throw new Error(`日程时间格式不正确：${detail.title}`);
  }
  const minutes = detail.durationMinutes && detail.durationMinutes > 0
    ? detail.durationMinutes
    : 60;
  return {
    eventId: detail.id,
    title: detail.title,
    startMillis,
    endMillis: startMillis + minutes * 60_000,
    allDay: false,
    timezone: detail.timezone || APP_TIMEZONE,
    rrule: detail.rrule?.trim() ?? '',
    description: detail.description ?? '',
    locationName: detail.locationName ?? '',
    locationDetail: detail.locationDetail ?? '',
    locationAddress: detail.locationAddress ?? '',
  };
}

/**
 * 把待办转换成系统日历条目。
 *
 * 未完成的待办都会导出；已完成和已取消返回 null。
 * 有截止时间的待办按“截止日全天”导出，今天截止就显示在今天，
 * 不再把整条待办画成一年长的日程；没有截止时间的待办从今天开始持续显示。
 */
export function buildSystemCalendarTask(
  task: Task,
  now: Date = new Date(),
): SystemCalendarEvent | null {
  if (task.status !== 'TODO') {
    return null;
  }

  let startMillis: number;
  let endMillis: number;
  let sourceNote: string;
  if (task.dueAt) {
    const dueMillis = Date.parse(task.dueAt);
    if (!Number.isFinite(dueMillis)) {
      return null;
    }
    // 截止时间是“今天 18:00”这种具体时刻，但系统日历里用整天表示，
    // 避免一个待办占满一年；具体时刻写进备注，用户仍能看到。
    const dueDate = appDateKey(new Date(dueMillis));
    startMillis = appDayStartUtcMillis(dueDate);
    endMillis = startMillis + DAY_MS;
    sourceNote = `${SYSTEM_CALENDAR_SOURCE_NOTE} · 待办（截止 ${formatAppDateTime(dueMillis)}）`;
  } else {
    startMillis = appDayStartUtcMillis(appDateKey(now));
    if (!Number.isFinite(startMillis)) {
      return null;
    }
    endMillis = startMillis + SYSTEM_CALENDAR_TASK_DEFAULT_END_MS;
    sourceNote = `${SYSTEM_CALENDAR_SOURCE_NOTE} · 待办（未设置截止时间，从今天起持续显示）`;
  }

  const note = task.description?.trim() ?? '';
  return {
    // 原生模块只认识 eventId；日程用正数，待办用负数，映射表里不会互相覆盖。
    eventId: -task.id,
    title: task.title,
    startMillis,
    endMillis,
    allDay: true,
    timezone: APP_TIMEZONE,
    // 没有截止时间的待办是「持续显示」的一条，不套用重复规则，
    // 否则会和 365 天的跨度叠加成大量重叠事件。
    rrule: task.dueAt ? (task.rrule?.trim() ?? '') : '',
    description: note ? `${note}\n\n${sourceNote}` : sourceNote,
    locationName: task.locationName ?? '',
    locationDetail: task.locationDetail ?? '',
    locationAddress: task.locationAddress ?? '',
  };
}

/** 把 YYYY-MM-DD 转成该日 UTC 零点；系统日历的全天事件按 UTC 零点落库。 */
function appDayStartUtcMillis(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number) as [number, number, number];
  return Date.UTC(year, month - 1, day);
}

/** 备注里保留待办的具体截止时刻，例如 2026-11-18 18:00。 */
function formatAppDateTime(millis: number): string {
  const date = new Date(millis);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: APP_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
  return `${appDateKey(date)} ${time}`;
}

/**
 * 首次开启同步时，有截止时间的待办只补时间窗内的；没有截止时间的待办
 * 从今天开始，全部补上。完成 / 取消的待办不补，并会顺手删除旧条目。
 */
export function isSystemCalendarTaskInBackfillRange(
  task: Task,
  rangeStart: number,
  rangeEnd: number,
): boolean {
  if (task.status !== 'TODO') {
    return false;
  }
  if (!task.dueAt) {
    return true;
  }
  const due = Date.parse(task.dueAt);
  return Number.isFinite(due) && due >= rangeStart && due <= rangeEnd;
}

/**
 * 首次开启同步时回填的时间窗：往前 30 天、往后 365 天。
 *
 * 不导出全部历史：系统日历里堆满两年前的旧日程既没用，也会让第一次开启等很久。
 */
export const SYSTEM_CALENDAR_BACKFILL_DAYS_BACK = 30;
export const SYSTEM_CALENDAR_BACKFILL_DAYS_FORWARD = 365;

/** 生成后端 `GET /events?start=&end=` 要的 ISO 边界（固定 UTC+8）。 */
export function systemCalendarBackfillRange(
  now: Date = new Date(),
  daysBack: number = SYSTEM_CALENDAR_BACKFILL_DAYS_BACK,
  daysForward: number = SYSTEM_CALENDAR_BACKFILL_DAYS_FORWARD,
): { start: string; end: string } {
  const startKey = appDateKey(new Date(now.getTime() - daysBack * 86_400_000));
  const endKey = appDateKey(new Date(now.getTime() + daysForward * 86_400_000));
  return {
    start: `${startKey}T00:00:00${APP_UTC_OFFSET}`,
    end: `${endKey}T23:59:59${APP_UTC_OFFSET}`,
  };
}

function appDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
