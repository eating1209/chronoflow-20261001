/**
 * calendar 模块的公开出口。
 *
 * 模块内分三个入口：
 * - `index.ts`      页面与完整能力（App 导航使用）
 * - `pure.ts`       纯日期 / 草稿 / 重复规则逻辑（tasks、vision、notifications、单测使用）
 * - `components.ts` 月历、滚轮、地图等可复用组件（组织日程、待办编辑使用）
 *
 * 其他模块只能走这三个公开入口，不许直接 import `screens/`、`domain/`、
 * `components/` 内部实现。
 */
export { AgendaScreen } from './screens/AgendaScreen';
export { EventEditorScreen } from './screens/EventEditorScreen';
export { EventPickerScreen } from './screens/EventPickerScreen';
export { LocationPickerScreen } from './screens/LocationPickerScreen';
export { RecurrencePickerScreen } from './screens/RecurrencePickerScreen';
export { ReminderPickerScreen } from './screens/ReminderPickerScreen';

export type {
  PickedEvent,
  PlaceSelection,
  RecurrenceSelection,
  ReminderSelection,
  ReminderSoundChoice,
} from './pure';

export {
  backfillSystemCalendar,
  clearSystemCalendarEvents,
  ensureSystemCalendarTaskBackfill,
  removeSystemCalendarEvent,
  removeSystemCalendarTask,
  setSystemCalendarEnabled,
  syncEventToSystemCalendar,
  syncTaskToSystemCalendar,
  systemCalendarAvailable,
  systemCalendarDiagnostics,
  systemCalendarEnabled,
} from './systemCalendar';
