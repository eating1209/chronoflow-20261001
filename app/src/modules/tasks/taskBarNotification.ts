import { DeviceEventEmitter, NativeModules, Platform, TurboModuleRegistry } from 'react-native';

import type { Endpoints } from '../../api/endpoints';
import type { EventOccurrence, Task } from '../../shared/api';
import { APP_TIMEZONE, dateKeyToIso, localDateKey } from '../calendar/pure';
import { removeSystemCalendarTask } from '../calendar/systemCalendar';
import { buildTaskBarPayload } from './domain/taskBar';
import { eventOverviewEntry, taskOverviewEntry } from './domain/taskOverview';

/** 通知里只看未来一周的日程；全部未完成待办不受这个窗口限制。 */
export const TASK_BAR_EVENT_WINDOW_DAYS = 7;

/** 通知 id 固定：每次更新覆盖同一条，不会在通知栏堆出一串任务总览。 */
export const TASK_BAR_NOTIFICATION_ID = 'chronoflow-taskbar-overview';
// 渠道创建后 Android 不允许修改锁屏重要级，换 id 让已安装用户也用上新的公开渠道。
export const TASK_BAR_CHANNEL_ID = 'taskbar-overview-v2';

type NotificationsModule = typeof import('expo-notifications');

type NativeTaskBarModule = {
  update(payloadJson: string): Promise<boolean>;
  clear(): Promise<boolean>;
  isPermissionGranted(): Promise<boolean>;
  pendingCompletions(): Promise<string>;
  ackCompletions(keysJson: string): Promise<boolean>;
  canDrawOverlays?(): Promise<boolean>;
  hasUsageAccess?(): Promise<boolean>;
  requestUsageAccess?(): Promise<boolean>;
  isOverlayEnabled?(): Promise<boolean>;
  requestOverlayPermission?(): Promise<boolean>;
  startOverlay?(): Promise<boolean>;
  stopOverlay?(): Promise<boolean>;
  diagnostics?(): Promise<string>;
};

let channelReady = false;
let flushInFlight: Promise<number> | null = null;

export interface PendingTaskBarCompletion {
  key: string;
  kind: 'task' | 'event';
  id: number;
  occurrenceDate: string | null;
  completedAt: string;
}

const changeListeners = new Set<() => void>();

/** 页面订阅这个事件，在锁屏完成同步到服务端后重新拉一次列表。 */
export function subscribeTaskBarChanges(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => {
    changeListeners.delete(listener);
  };
}

/** App 层订阅原生「通知里点了完成」事件，用来立即冲刷本地队列。 */
export function subscribeNativeTaskBarCompletion(listener: () => void): () => void {
  if (Platform.OS !== 'android') {
    return () => undefined;
  }
  const subscription = DeviceEventEmitter.addListener('chronoflow.taskbar.completed', listener);
  return () => subscription.remove();
}

function notifyTaskBarChanges(): void {
  for (const listener of [...changeListeners]) {
    try {
      listener();
    } catch {
      // 单个页面刷新失败不能影响其它订阅者。
    }
  }
}

/**
 * 原生三色卡片优先，expo-notifications 作为兜底。
 *
 * <p>原生模块负责绘制通知；顶部悬浮小条是单独开关，只有用户授权后才会启动。
 * 找不到模块或厂商系统拒绝 RemoteViews 时，自动退回普通常驻通知，保证 App 本身仍能正常打开。
 */
function nativeTaskBarModule(): NativeTaskBarModule | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  const legacy = (NativeModules as Record<string, unknown>).ChronoflowTaskBar;
  let turbo: unknown = null;
  if (!legacy) {
    try {
      const registry = TurboModuleRegistry as unknown as {
        get?: (name: string) => unknown;
      };
      turbo = registry.get?.('ChronoflowTaskBar') ?? null;
    } catch {
      turbo = null;
    }
  }
  const candidate = legacy ?? turbo;
  if (!candidate || (typeof candidate !== 'object' && typeof candidate !== 'function')) {
    return null;
  }
  const module = candidate as Partial<NativeTaskBarModule>;
  if (typeof module.update !== 'function' || typeof module.clear !== 'function') {
    return null;
  }
  return module as NativeTaskBarModule;
}

async function notificationsModule(): Promise<NotificationsModule | null> {
  if (Platform.OS !== 'android') {
    return null;
  }
  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

async function ensureChannel(Notifications: NotificationsModule): Promise<void> {
  if (channelReady) {
    return;
  }
  await Notifications.setNotificationChannelAsync(TASK_BAR_CHANNEL_ID, {
    name: '任务栏与锁屏任务总览',
    description: '在通知栏和锁屏持续显示未完成的待办与日程',
    importance: Notifications.AndroidImportance.HIGH,
    sound: null,
    enableVibrate: false,
    showBadge: false,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  channelReady = true;
}

function notificationBody(payload: ReturnType<typeof buildTaskBarPayload>): string {
  const groups = payload.groups.map((group) => `${group.label} ${group.count}`).join(' · ');
  return `最近 ${payload.nearestWhen} · ${payload.nearestTitle}\n${groups}`;
}

function parsePending(raw: string): PendingTaskBarCompletion[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item): item is PendingTaskBarCompletion => {
      if (!item || typeof item !== 'object') {
        return false;
      }
      const candidate = item as Partial<PendingTaskBarCompletion>;
      return (
        typeof candidate.key === 'string' &&
        (candidate.kind === 'task' || candidate.kind === 'event') &&
        typeof candidate.id === 'number' &&
        (candidate.occurrenceDate === null || typeof candidate.occurrenceDate === 'string') &&
        typeof candidate.completedAt === 'string'
      );
    });
  } catch {
    return [];
  }
}

/**
 * 把锁屏 / 通知栏里点掉的条目同步到服务端。
 *
 * <p>点击先由原生本地更新，断网也能立刻从卡片上消失；这里只在 App 启动或回到前台时补做
 * 网络请求。成功的 action 才从本地队列删除，网络失败就留到下一次，不会丢完成状态。
 */
export function flushPendingTaskBarCompletions(api: Endpoints): Promise<number> {
  if (flushInFlight) {
    return flushInFlight;
  }
  const nativeModule = nativeTaskBarModule();
  if (!nativeModule || typeof nativeModule.pendingCompletions !== 'function') {
    return Promise.resolve(0);
  }

  flushInFlight = (async () => {
    let pending: PendingTaskBarCompletion[] = [];
    try {
      pending = parsePending(await nativeModule.pendingCompletions());
    } catch {
      return 0;
    }
    if (pending.length === 0) {
      return 0;
    }

    const acknowledged: string[] = [];
    for (const action of pending) {
      try {
        if (action.kind === 'task') {
          await api.completeTask(action.id, true);
          await removeSystemCalendarTask(action.id);
        } else {
          await api.completeEvent(action.id, true, action.occurrenceDate);
        }
        acknowledged.push(action.key);
      } catch {
        // 保留这一条，下次回前台再重试。
      }
    }

    if (acknowledged.length === 0) {
      return 0;
    }
    try {
      await nativeModule.ackCompletions(JSON.stringify(acknowledged));
    } catch {
      // 服务端已完成；下次重复提交 completion 是幂等的。
    }
    notifyTaskBarChanges();
    return acknowledged.length;
  })().finally(() => {
    flushInFlight = null;
  });

  return flushInFlight;
}

/**
 * 把任务总览同步到 Android 通知栏 / 锁屏。
 *
 * 通知本身是「持续通知」，只出现在系统通知区；顶部小条需要用户另行授权后开启。
 * 页面已经拉过数据时直接把 lists 传进来，避免为了刷新通知再请求一次接口。
 */
export async function syncTaskBarNotification(options: {
  api: Endpoints;
  enabled: boolean;
  tasks?: Task[];
  events?: EventOccurrence[];
  now?: number;
}): Promise<boolean> {
  if (!options.enabled) {
    return clearTaskBarNotification();
  }
  const Notifications = await notificationsModule();
  if (!Notifications) {
    return false;
  }

  const now = options.now ?? Date.now();
  let tasks = options.tasks;
  if (!tasks) {
    try {
      tasks = await options.api.tasks();
    } catch {
      return false;
    }
  }

  let events = options.events;
  if (!events) {
    const todayKey = localDateKey(new Date(now).toISOString(), APP_TIMEZONE);
    const endKey = localDateKey(
      new Date(now + TASK_BAR_EVENT_WINDOW_DAYS * 86_400_000).toISOString(),
      APP_TIMEZONE,
    );
    events = await options.api
      .eventsInRange(dateKeyToIso(todayKey), dateKeyToIso(endKey, true))
      .catch(() => [] as EventOccurrence[]);
  }

  const windowEnd = now + TASK_BAR_EVENT_WINDOW_DAYS * 86_400_000;
  const entries = [
    ...tasks.filter((task) => task.status === 'TODO').map(taskOverviewEntry),
    ...events
      .filter((event) => {
        const at = Date.parse(event.at);
        return !event.done && at >= now && at <= windowEnd;
      })
      .map(eventOverviewEntry),
  ];
  const payload = buildTaskBarPayload(entries, now, APP_TIMEZONE);

  // 没有未完成事项时不保留一条空通知，避免用户永远无法从通知栏清掉它。
  if (payload.total === 0) {
    return clearTaskBarNotification();
  }

  // 设计稿里的三色比例条、今日截止和最近一项都画在原生 RemoteViews 上。
  // 只有原生更新失败时才创建系统通知，避免同一条总览出现两份。
  const nativeModule = nativeTaskBarModule();
  let nativeFailure = nativeModule ? '原生模块更新失败' : '原生模块未加载';
  if (nativeModule) {
    try {
      if (await nativeModule.update(JSON.stringify(payload))) {
        return true;
      }
      if (typeof nativeModule.diagnostics === 'function') {
        try {
          const diagnosis = JSON.parse(await nativeModule.diagnostics()) as {
            lastError?: unknown;
          };
          if (typeof diagnosis.lastError === 'string' && diagnosis.lastError) {
            nativeFailure += `：${diagnosis.lastError}`;
          }
        } catch {
          // 诊断本身失败时只保留上面的通用原因。
        }
      }
    } catch (cause) {
      nativeFailure = `原生模块异常：${cause instanceof Error ? cause.message : String(cause)}`;
    }
  }

  try {
    await ensureChannel(Notifications);
    // 固定 id 覆盖旧内容；先 dismiss 一次，避免部分厂商系统把更新排成第二条。
    await Notifications.dismissNotificationAsync(TASK_BAR_NOTIFICATION_ID).catch(() => undefined);
    await Notifications.scheduleNotificationAsync({
      identifier: TASK_BAR_NOTIFICATION_ID,
      content: {
        title: `时纪流 · ${payload.headline}`,
        // 测试包里带上失败原因，方便截图定位；原生卡片正常时不会出现这行。
        body: `${notificationBody(payload)}\n[测试诊断] ${nativeFailure}`,
        color: '#25262A',
        sound: false,
        autoDismiss: false,
        sticky: true,
        priority: Notifications.AndroidNotificationPriority.DEFAULT,
        data: { kind: 'taskbar-overview', sound: 'silent' },
      },
      // 立即展示，同时让通知落到专门的公开锁屏渠道上。
      trigger: { channelId: TASK_BAR_CHANNEL_ID },
    });
    return true;
  } catch {
    return false;
  }
}

export async function clearTaskBarNotification(): Promise<boolean> {
  let nativeCleared = false;
  const nativeModule = nativeTaskBarModule();
  if (nativeModule) {
    try {
      nativeCleared = await nativeModule.clear();
    } catch {
      nativeCleared = false;
    }
  }

  const Notifications = await notificationsModule();
  if (!Notifications) {
    return nativeCleared;
  }
  try {
    await Notifications.dismissNotificationAsync(TASK_BAR_NOTIFICATION_ID);
    await Notifications.cancelScheduledNotificationAsync(TASK_BAR_NOTIFICATION_ID).catch(
      () => undefined,
    );
    return true;
  } catch {
    return nativeCleared;
  }
}

export async function taskBarNotificationPermissionGranted(): Promise<boolean> {
  const nativeModule = nativeTaskBarModule();
  if (nativeModule && typeof nativeModule.isPermissionGranted === 'function') {
    try {
      if (await nativeModule.isPermissionGranted()) {
        return true;
      }
    } catch {
      // 继续用 expo 的权限结果兜底。
    }
  }

  const Notifications = await notificationsModule();
  if (!Notifications) {
    return false;
  }
  try {
    const permission = await Notifications.getPermissionsAsync();
    return permission.status === 'granted';
  } catch {
    return false;
  }
}

/** 检查系统是否允许“显示在其他应用上层”；没有该权限就无法创建顶部小条。 */
export async function taskBarOverlayPermissionGranted(): Promise<boolean> {
  const nativeModule = nativeTaskBarModule();
  if (!nativeModule || typeof nativeModule.canDrawOverlays !== 'function') {
    return false;
  }
  try {
    return await nativeModule.canDrawOverlays();
  } catch {
    return false;
  }
}

/** 打开系统悬浮窗授权页。返回 App 后由调用方重新尝试启动。 */
export async function requestTaskBarOverlayPermission(): Promise<boolean> {
  const nativeModule = nativeTaskBarModule();
  if (!nativeModule || typeof nativeModule.requestOverlayPermission !== 'function') {
    return false;
  }
  try {
    return await nativeModule.requestOverlayPermission();
  } catch {
    return false;
  }
}

/** 是否允许“使用情况访问”：Android 14+ 靠它判断桌面，否则只能退回细条。 */
export async function taskBarUsageAccessGranted(): Promise<boolean> {
  const nativeModule = nativeTaskBarModule();
  if (!nativeModule || typeof nativeModule.hasUsageAccess !== 'function') {
    return false;
  }
  try {
    return await nativeModule.hasUsageAccess();
  } catch {
    return false;
  }
}

/** 打开“使用情况访问”系统授权页；返回 App 后由页面重新检查。 */
export async function requestTaskBarUsageAccess(): Promise<boolean> {
  const nativeModule = nativeTaskBarModule();
  if (!nativeModule || typeof nativeModule.requestUsageAccess !== 'function') {
    return false;
  }
  try {
    return await nativeModule.requestUsageAccess();
  } catch {
    return false;
  }
}

export async function taskBarOverlayEnabled(): Promise<boolean> {
  const nativeModule = nativeTaskBarModule();
  if (!nativeModule || typeof nativeModule.isOverlayEnabled !== 'function') {
    return false;
  }
  try {
    return await nativeModule.isOverlayEnabled();
  } catch {
    return false;
  }
}

/** 开启/关闭顶部任务小条。开启前必须已经拿到 system alert window 权限。 */
export async function setTaskBarOverlayEnabled(enabled: boolean): Promise<boolean> {
  const nativeModule = nativeTaskBarModule();
  if (!nativeModule) {
    return false;
  }
  try {
    if (!enabled) {
      return typeof nativeModule.stopOverlay === 'function'
        ? await nativeModule.stopOverlay()
        : false;
    }
    if (typeof nativeModule.startOverlay !== 'function') {
      return false;
    }
    return await nativeModule.startOverlay();
  } catch {
    return false;
  }
}

/** App 重启 / 回到前台时恢复用户之前开启的顶部小条。 */
export async function restoreTaskBarOverlay(): Promise<boolean> {
  const nativeModule = nativeTaskBarModule();
  if (
    !nativeModule ||
    typeof nativeModule.isOverlayEnabled !== 'function' ||
    typeof nativeModule.startOverlay !== 'function'
  ) {
    return false;
  }
  try {
    if (!(await nativeModule.isOverlayEnabled())) {
      return false;
    }
    return await nativeModule.startOverlay();
  } catch {
    return false;
  }
}
