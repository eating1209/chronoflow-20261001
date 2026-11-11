import { NativeModules, Platform } from 'react-native';

import type { EventDetail, EventOccurrence } from '../../shared/api';
import {
  buildSystemCalendarEvent,
  systemCalendarBackfillRange,
} from './domain/systemCalendar';

/**
 * 系统日历单向导出的 JS 门面。
 *
 * 只在 Android 上生效：原生侧用 CalendarContract 写入系统日历。
 * iOS 的 EventKit 版本后续单独做，这里不会假装可用。
 */
const STORAGE_KEY = 'chronoflow.system-calendar';
const NATIVE_MODULE = 'ChronoflowCalendar';

interface CalendarNativeModule {
  upsertEvent: (payloadJson: string) => Promise<number>;
  deleteEvent: (eventId: number) => Promise<boolean>;
  clearAll: () => Promise<boolean>;
  diagnostics: () => Promise<string>;
}

interface CalendarDiagnostics {
  readGranted: boolean;
  writeGranted: boolean;
  calendarId: number;
}

export interface SystemCalendarApi {
  eventsInRange: (start: string, end: string) => Promise<EventOccurrence[]>;
  eventDetail: (eventId: number) => Promise<EventDetail>;
}

export interface SystemCalendarBackfillResult {
  exported: number;
  failed: number;
}

let enabledCache: boolean | null = null;

function native(): CalendarNativeModule | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  return (NativeModules[NATIVE_MODULE] as CalendarNativeModule | undefined) ?? null;
}

/** 当前构建里有没有系统日历模块（旧安装包 / iOS / Web 都没有）。 */
export function systemCalendarAvailable(): boolean {
  return native() !== null;
}

/** 用户是否开启「同步到系统日历」。读不到一律按关闭处理。 */
export async function systemCalendarEnabled(): Promise<boolean> {
  if (enabledCache !== null) {
    return enabledCache;
  }
  try {
    const SecureStore = await import('expo-secure-store');
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    enabledCache = raw === '1';
  } catch {
    enabledCache = false;
  }
  return enabledCache;
}

export async function setSystemCalendarEnabled(enabled: boolean): Promise<void> {
  enabledCache = enabled;
  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // 存不下就只对本次运行生效；功能本身还能用，不因此拦住用户。
  }
}

export async function systemCalendarDiagnostics(): Promise<CalendarDiagnostics | null> {
  const module = native();
  if (!module) {
    return null;
  }
  try {
    return JSON.parse(await module.diagnostics()) as CalendarDiagnostics;
  } catch {
    return null;
  }
}

/**
 * 新建 / 修改一条日程后调用。
 *
 * 失败不会抛给调用方：系统日历写不进去（没权限、没有日历账户）不该让「日程已保存」
 * 变成一次失败。返回值只用于诊断 / 设置页提示。
 */
export async function syncEventToSystemCalendar(detail: EventDetail): Promise<boolean> {
  const module = native();
  if (!module || !(await systemCalendarEnabled())) {
    return false;
  }
  try {
    await module.upsertEvent(JSON.stringify(buildSystemCalendarEvent(detail)));
    return true;
  } catch {
    return false;
  }
}

/** 删除一条已经导出过的日程；没导出过也无所谓。 */
export async function removeSystemCalendarEvent(eventId: number): Promise<boolean> {
  const module = native();
  if (!module || !(await systemCalendarEnabled())) {
    return false;
  }
  try {
    await module.deleteEvent(eventId);
    return true;
  } catch {
    return false;
  }
}

/** 关闭同步时清掉所有由时纪流写入的事件，不动用户自己记的内容。 */
export async function clearSystemCalendarEvents(): Promise<boolean> {
  const module = native();
  if (!module) {
    return false;
  }
  try {
    await module.clearAll();
    return true;
  } catch {
    return false;
  }
}

/**
 * 首次开启时把最近 30 天到未来 365 天的日程补进系统日历。
 *
 * 重复日程在 `eventsInRange` 里会展开成很多次出现；这里按 eventId 去重后只取一次详情，
 * 用 RRULE 整条导出，避免系统日历里出现几十条同名日程。
 */
export async function backfillSystemCalendar(
  api: SystemCalendarApi,
): Promise<SystemCalendarBackfillResult> {
  const module = native();
  if (!module) {
    throw new Error('当前版本不支持同步到系统日历');
  }
  const diagnostics = await systemCalendarDiagnostics();
  if (!diagnostics?.writeGranted) {
    throw new Error('没有获得系统日历权限');
  }
  if (!diagnostics.calendarId || diagnostics.calendarId <= 0) {
    throw new Error('手机里没有可写入的日历账户');
  }

  const range = systemCalendarBackfillRange();
  const occurrences = await api.eventsInRange(range.start, range.end);
  const eventIds = [...new Set(occurrences.map((item) => item.eventId))].slice(0, 300);

  let exported = 0;
  let failed = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < eventIds.length) {
      const eventId = eventIds[cursor];
      cursor += 1;
      try {
        const detail = await api.eventDetail(eventId);
        await module.upsertEvent(JSON.stringify(buildSystemCalendarEvent(detail)));
        exported += 1;
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, eventIds.length) }, worker));
  return { exported, failed };
}
