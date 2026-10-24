/**
 * org 模块的公开出口。
 *
 * 负责组织 tab、组织日程列表与下发编辑、选人页、组织账号认领，
 * 以及下发表单和选人分组/搜索/整组勾选的纯逻辑。
 *
 * 其他模块和 App 只能从这里使用组织能力，不许直接 import
 * `modules/org/screens/...` 或 `modules/org/domain/...`。
 */
export { OrgTabScreen } from './screens/OrgTabScreen';
export { OrgEventsScreen } from './screens/OrgEventsScreen';
export { OrgEventEditorScreen } from './screens/OrgEventEditorScreen';
export { OrgRecipientPickerScreen } from './screens/OrgRecipientPickerScreen';
export { OrgAccountsScreen } from './screens/OrgAccountsScreen';

export {
  buildDispatchPayload,
  buildUpdatePayload,
  canDispatch,
  validateDispatchForm,
  type DispatchForm,
} from './domain/orgDispatch';

export {
  addIds,
  buildRecipientGroups,
  filterRecipientGroups,
  isGroupFullySelected,
  removeIds,
  selectedSummary,
  toggleId,
  type RecipientGroup,
  type RecipientOption,
} from './domain/orgRecipients';
