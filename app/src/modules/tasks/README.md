# tasks 模块 · 待办

**管什么**：待办列表、新建/编辑、完成勾选、优先级、截止时间、关联日程、重复规则和提醒入口。

**对外出口**：`index.ts`（别的模块只能从这里 import）

| 导出 | 用途 |
| --- | --- |
| `TasksScreen` | 待办列表页 |
| `TaskEditorScreen` | 新建 / 编辑待办整页 |
| `emptyTaskDraft` / `draftFromTask` | 草稿初始化与回填 |
| `validateTaskDraft` | 保存前校验 |
| `buildCreateTaskPayload` / `buildUpdateTaskPayload` | 生成服务端请求体 |
| `TASK_PRIORITY_OPTIONS` / `TaskDraft` | 优先级选项与草稿类型 |

**目录**

```
tasks/
├── domain/taskDraft.ts    待办草稿、校验、请求体映射（纯逻辑，可单测）
├── screens/TasksScreen.tsx
├── screens/TaskEditorScreen.tsx
└── index.ts               唯一出口
```

**依赖谁**：共享 UI、`modules/calendar/pure`（日期、草稿与重复规则）、
`modules/calendar/components`（日期/时间滚轮）、`modules/notifications`，以及 `api` 里的待办端点。

**谁依赖它**：`App.tsx`（注册页面与底部 Tab）。

**测试**：`app/test/taskDraft.test.ts`。测试目录不参与模块边界检查，直接测纯逻辑。

**注意**

- 待办允许没有截止时间，归入「待安排」；这个状态用 `hasDue` 显式表达，不要靠空字符串猜。
- 重复规则空串表示「不重复」；PATCH 里 `null` 表示「不修改」，两者不能混。
- 提醒不挂在待办行上，编辑页需要单独拉取并保存 `GET/PUT /reminders`。
- 本阶段只搬文件、拆边界，API 端点仍集中在 `app/src/api/endpoints.ts`；下一步再拆模块级 `api.ts`。
