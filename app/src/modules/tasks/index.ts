/**
 * tasks 模块的公开出口。
 *
 * 其他模块和 App 只能从这里使用待办能力，不许直接 import
 * `modules/tasks/screens/...` 或 `modules/tasks/domain/...`。
 */
export { TaskEditorScreen } from './screens/TaskEditorScreen';
export { TasksScreen } from './screens/TasksScreen';

export {
  TASK_PRIORITY_OPTIONS,
  buildCreateTaskPayload,
  buildUpdateTaskPayload,
  draftFromTask,
  emptyTaskDraft,
  validateTaskDraft,
  type TaskDraft,
  type TaskDraftValidation,
} from './domain/taskDraft';
