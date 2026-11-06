/**
 * notifications 模块的公开出口。
 *
 * 这个模块把三件事放在一起：
 * - 本机提醒：偏好、声音档位、排期、账本、点击路由；
 * - 提醒设置的保存与重排；
 * - 应用内更新：版本判定、APK 下载和更新弹窗。
 *
 * 其他模块和页面只能从这里使用通知能力，不许直接 import 内部实现。
 *
 * 公共的通知偏好与声音档位位于 `shared/notifications`，本模块只保留排期、路由、
 * 动作与更新界面；这样 `context/AppContext` 不需要反向依赖业务模块。
 */
export {
  AppUpdateProvider,
  readLocalVersionCode,
  readLocalVersionName,
  useAppUpdate,
} from './screens/AppUpdater';

export {
  decideUpdate,
  forceReasonText,
  formatBytes,
  resolveApkUrl,
  updateChangelog,
  updateTitle,
  type UpdateDecision,
} from './domain/appUpdate';

export {
  persistReminderSettings,
  refreshLocalReminders,
} from './actions';

export { localNotificationsAvailable } from '../../shared/notifications/availability';

export {
  DEFAULT_REMINDER_SOUND,
  REMINDER_SOUND_OPTIONS,
  channelIdFor,
  currentReminderSound,
  describeReminderSound,
  parseReminderSound,
  setCurrentReminderSound,
  type ReminderSound,
} from '../../shared/notifications';

export {
  DEFAULT_NOTIFICATION_PREFS,
  createMemoryNotificationPrefsStore,
  createSecureNotificationPrefsStore,
  parseNotificationPrefs,
  type NotificationPrefs,
  type NotificationPrefsStore,
} from '../../shared/notifications';

export {
  routeFromNotificationData,
  routeFromResponse,
  tapFromResponse,
  type NotificationResponseLike,
  type NotificationRoute,
  type NotificationTap,
} from './route';

export {
  actionKindFor,
  actionsFor,
  categoryIdFor,
  COMPLETE_ACTION_ID,
  DEFAULT_ACTION_IDENTIFIER,
  REMINDER_CATEGORY_ID,
  SNOOZE_ACTION_ID,
  SNOOZE_MINUTES,
  type NotificationActionKind,
  type ReminderActionDefinition,
} from './reminderActions';

export { subscribeNotificationResponses } from './listener';

export * from './domain/reminderSchedule';
