import { NativeModules, Platform } from 'react-native';

import type { EventDetail, EventOccurrence, Task } from '../../shared/api';
import {
  buildSystemCalendarEvent,
  buildSystemCalendarTask,
  isSystemCalendarTaskInBackfillRange,
  systemCalendarBackfillRange,
} from './domain/systemCalendar';

/**
 * 系统日历单向导出的 JS 门面。
 *
 * 只在 Android 上生效：原生侧用 CalendarContract 写入系统日历。
 * iOS 的 EventKit 版本后续单独做，这里不会假装可用。
 */
const STORAGE_KEY = 'chronoflow.system-calendar';
const TASK_DEFAULT_DATE_BACKFILL_KEY = 'chronoflow.system-calendar.task-default-end-v3';
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
  tasks: () => Promise<Task[]>;
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

async function taskDefaultDateBackfillDone(): Promise<boolean> {
  try {
    const SecureStore = await import('expo-secure-store');
    return (await SecureStore.getItemAsync(TASK_DEFAULT_DATE_BACKFILL_KEY)) === '1';
  } catch {
    return false;
  }
}

async function markTaskDefaultDateBackfillDone(): Promise<void> {
  try {
    const SecureStore = await import('expo-secure-store');
    await SecureStore.setItemAsync(TASK_DEFAULT_DATE_BACKFILL_KEY, '1');
  } catch {
    // 标记没存上只会导致下次启动再补一次；同 id 是更新而不是新增。
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
  return removeSystemCalendarEventId(eventId);
}

async function removeSystemCalendarEventId(eventId: number): Promise<boolean> {
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

/**
 * 新建 / 修改待办后调用。
 *
 * 有截止时间的待办按截止日全天导出；没有截止时间的待办从今天开始、
 * 持续显示在系统日历里。完成或取消时删除旧条目。
 */
export async function syncTaskToSystemCalendar(task: Task): Promise<boolean> {
  const module = native();
  if (!module || !(await systemCalendarEnabled())) {
    return false;
  }
  try {
    const payload = buildSystemCalendarTask(task);
    if (!payload) {
      await module.deleteEvent(-task.id);
      return true;
    }
    await module.upsertEvent(JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

/** 删除待办时，把系统日历里对应的条目也撤掉。 */
export async function removeSystemCalendarTask(taskId: number): Promise<boolean> {
  return removeSystemCalendarEventId(-taskId);
}

/**
 * 旧版本把待办导出成一年长的日程；升级后把现有未完成待办补一遍，
 * 有截止时间的改成截止日全天，没有截止时间的从今天起持续显示。
 *
 * 只在一个账号的这次升级后执行一次；用户没有开启系统日历同步时完全不动。
 * 失败不打扰用户，下次启动再试；系统日历按负数 task id 更新，不会重复创建。
 */
export async function ensureSystemCalendarTaskBackfill(
  api: SystemCalendarApi,
): Promise<void> {
  const module = native();
  if (!module || !(await systemCalendarEnabled())) {
    return;
  }
  if (await taskDefaultDateBackfillDone()) {
    return;
  }
  const diagnostics = await systemCalendarDiagnostics();
  if (!diagnostics?.writeGranted || diagnostics.calendarId <= 0) {
    return;
  }

  let tasks: Task[];
  try {
    tasks = await api.tasks();
  } catch {
    return;
  }

  const now = new Date();
  let failed = 0;
  for (const task of tasks.slice(0, 300)) {
    try {
      const payload = buildSystemCalendarTask(task, now);
      if (payload) {
        await module.upsertEvent(JSON.stringify(payload));
      } else {
        await module.deleteEvent(-task.id);
      }
    } catch {
      failed += 1;
    }
  }
  if (failed === 0) {
    await markTaskDefaultDateBackfillDone();
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

  // 待办复用同一套映射：负数 id 与日程的正数 id 天然分开。
  let tasks: Task[] = [];
  try {
    tasks = await api.tasks();
  } catch {
    // 待办接口失败不影响已经补完的日程；下次开启同步会再试。
  }
  const rangeStart = Date.parse(range.start);
  const rangeEnd = Date.parse(range.end);
  const backfillNow = new Date();
  for (const task of tasks.slice(0, 300)) {
    try {
      const shouldExport = isSystemCalendarTaskInBackfillRange(task, rangeStart, rangeEnd);
      const payload = shouldExport ? buildSystemCalendarTask(task, backfillNow) : null;
      if (payload) {
        await module.upsertEvent(JSON.stringify(payload));
        exported += 1;
      } else {
        await module.deleteEvent(-task.id);
      }
    } catch {
      failed += 1;
    }
  }
  if (failed === 0) {
    await markTaskDefaultDateBackfillDone();
  }
  return { exported, failed };
}
