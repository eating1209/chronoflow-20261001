/** 共享通知纯逻辑：本机通知偏好与提醒声音档位。 */
export * from './prefs';
export * from './sound';

/**
 * `availability.ts` 刻意不从这里导出：它依赖 Expo / React Native，
 * Node 单测如果只引用声音或偏好，不应该被迫加载原生运行时。
 * 需要判断通知可用性时请直接 import `shared/notifications/availability`。
 */
