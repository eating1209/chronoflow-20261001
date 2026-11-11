import type { EventDetail } from '../../../shared/api';
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

export interface SystemCalendarEvent {
  eventId: number;
  title: string;
  /** 绝对时刻（epoch 毫秒），系统日历按这个值落库 */
  startMillis: number;
  endMillis: number;
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
    timezone: detail.timezone || APP_TIMEZONE,
    rrule: detail.rrule?.trim() ?? '',
    description: detail.description ?? '',
    locationName: detail.locationName ?? '',
    locationDetail: detail.locationDetail ?? '',
    locationAddress: detail.locationAddress ?? '',
  };
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
