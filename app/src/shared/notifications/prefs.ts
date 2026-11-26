import { DEFAULT_REMINDER_SOUND, parseReminderSound, type ReminderSound } from './sound';

/**
 * 通知总开关（spec §4.5「用户在设置 - 通知中可按类型开关」）。
 *
 * 存本机而不是服务端：提醒是**本机通知**，与设备绑定；服务端那份 `reminder` 记录
 * 是「这条日程设了哪些提前量」，与「这台手机要不要响」是两件事 —— 换设备时
 * 新设备按默认值来，符合用户预期（他在旧设备开/关的是旧设备）。
 *
 * 默认**关闭**（2026-10-01 产品决定）：通知属于「用户主动要的打扰」，没问过就不该发。
 * 代价是「设了提醒却不响」，因此提醒页会明确写出总开关的状态，引导用户去打开，
 * 不能让这变成一个静默失效的功能。
 */
const STORAGE_KEY = 'chronoflow.notification-prefs';

export interface NotificationPrefs {
  /** 到点提醒总开关（本地通知） */
  enabled: boolean;
  /**
   * 任务栏 / 锁屏常驻任务总览。
   *
   * 和「到点提醒」分开：前者是一直看得见的总览，后者是到点才响的提醒。
   * 默认开启，但真正发通知前仍会单独申请系统通知权限；用户拒绝时由调用方写回 false。
   */
  taskBarEnabled: boolean;
  /**
   * 提醒声音档位（spec §4.5）。默认「系统提示音」：既然是用户主动开的提醒，
   * 默认就该听得见；想安静的可以自己切「静音」。
   */
  sound: ReminderSound;
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: false,
  taskBarEnabled: true,
  sound: DEFAULT_REMINDER_SOUND,
};

export interface NotificationPrefsStore {
  read: () => Promise<NotificationPrefs>;
  write: (prefs: NotificationPrefs) => Promise<void>;
}

/** 解析存储里的原始串；坏数据一律回默认值（关闭），不影响 App 启动。 */
export function parseNotificationPrefs(raw: string | null): NotificationPrefs {
  if (!raw) {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
  try {
    const parsed = JSON.parse(raw) as {
      enabled?: unknown;
      taskBarEnabled?: unknown;
      sound?: unknown;
    };
    return {
      enabled:
        typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULT_NOTIFICATION_PREFS.enabled,
      taskBarEnabled:
        typeof parsed.taskBarEnabled === 'boolean'
          ? parsed.taskBarEnabled
          : DEFAULT_NOTIFICATION_PREFS.taskBarEnabled,
      // 老版本只存了 enabled，没有 sound：补默认值而不是丢掉整条记录
      sound: parseReminderSound(parsed.sound),
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_PREFS };
  }
}

export function createMemoryNotificationPrefsStore(
  initial: NotificationPrefs = DEFAULT_NOTIFICATION_PREFS,
): NotificationPrefsStore {
  let current = { ...initial };
  return {
    async read() {
      return { ...current };
    },
    async write(prefs) {
      current = { ...prefs };
    },
  };
}

export async function createSecureNotificationPrefsStore(): Promise<NotificationPrefsStore> {
  const SecureStore = await import('expo-secure-store');
  return {
    async read() {
      return parseNotificationPrefs(await SecureStore.getItemAsync(STORAGE_KEY));
    },
    async write(prefs) {
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(prefs));
    },
  };
}
