import { tapFromResponse, type NotificationTap } from './route';
import { localNotificationsAvailable } from '../../shared/notifications/availability';

/**
 * 监听「用户点了本地通知」（spec §4.5）。
 *
 * 两种时机都要覆盖，少一个就会出现「点了通知没反应」：
 *   1. **App 已经在运行**：`addNotificationResponseReceivedListener`；
 *   2. **App 是被通知点开的**（冷启动）：那一次点击发生在监听注册之前，
 *      只能靠 `getLastNotificationResponseAsync` 补捞。
 *
 * 与其它通知模块一样用动态 import：Web 预览 / 缺原生模块时不影响 App 启动。
 */
export async function subscribeNotificationResponses(
  handler: (tap: NotificationTap) => void,
): Promise<() => void> {
  // Expo Go（Android）里连 import 都会抛（见 availability.ts）：直接当「没有通知」处理
  if (!localNotificationsAvailable()) {
    return () => undefined;
  }
  const Notifications = await import('expo-notifications');
  const seen = new Set<string>();
  const emit = (response: unknown) => {
    const tap = tapFromResponse(response as never);
    if (!tap) {
      return;
    }
    // 冷启动时 getLastNotificationResponseAsync 与实时监听可能拿到同一次点击；
    // 不去重的话「稍后」会被排两条，「完成」也会重复请求。
    if (tap.notificationId) {
      const key = `${tap.notificationId}:${tap.actionIdentifier}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
    }
    handler(tap);
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(emit);
  try {
    emit(await Notifications.getLastNotificationResponseAsync());
  } catch {
    // 拿不到「上次点击」不影响运行中的监听
  }
  return () => subscription.remove();
}
