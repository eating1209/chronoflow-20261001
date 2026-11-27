/**
 * tasks 模块的「系统能力」公开入口（通知 / 任务条 / 系统日历同步）。
 *
 * 不含页面组件，供其他模块（日历页、App 上下文、hooks）订阅任务条状态使用；
 * 走 `index.ts` 会连带拉起 `TasksScreen` / `TaskEditorScreen`，形成循环依赖
 * （dependency-cruiser 的 no-circular 规则会直接报错）。
 */
export {
  clearTaskBarNotification,
  flushPendingTaskBarCompletions,
  restoreTaskBarOverlay,
  subscribeNativeTaskBarCompletion,
  subscribeTaskBarChanges,
  syncTaskBarNotification,
} from './taskBarNotification';
