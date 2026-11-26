# tasks 模块 · 待办

**管什么**：待办列表、日程 + 待办合并的任务总览、新建/编辑、完成勾选、截止时间、重复规则和提醒入口。

**对外出口**：`index.ts`（别的模块只能从这里 import）

| 导出 | 用途 |
| --- | --- |
| `TasksScreen` | 待办列表页 |
| `TaskEditorScreen` | 新建 / 编辑待办整页 |
| `emptyTaskDraft` / `draftFromTask` | 草稿初始化与回填 |
| `validateTaskDraft` | 保存前校验 |
| `buildCreateTaskPayload` / `buildUpdateTaskPayload` | 生成服务端请求体 |
| `TaskDraft` | 待办草稿类型 |
| `syncTaskBarNotification` / `clearTaskBarNotification` | 同步 Android 通知栏 / 锁屏任务总览 |

**目录**

```
tasks/
├── components/TaskOverviewCard.tsx  顶部任务总览、待安排、已逾期与按月/按日排列的任务
├── components/CompletedTasksCard.tsx 页面最底部的「已完成」区
├── domain/taskOverview.ts 合并时间轴、月份分组、紧急度与截止时间文案（纯逻辑，可单测）
├── domain/taskBar.ts      通知栏 / 锁屏总览文案（纯逻辑，可单测）
├── domain/taskDraft.ts    待办草稿、校验、请求体映射（纯逻辑，可单测）
├── taskBarNotification.ts 持续通知适配层（原生三色卡片优先，expo-notifications 兜底；仅 Android）
├── screens/TasksScreen.tsx
├── screens/TaskEditorScreen.tsx
└── index.ts               唯一出口
```

**依赖谁**：共享 UI、`modules/calendar/pure`（日期、草稿与重复规则）、
`modules/calendar/components`（日期/时间滚轮）、`modules/notifications`，以及 `api` 里的待办端点。

**谁依赖它**：`App.tsx`（注册页面与底部 Tab）。

**测试**：`app/test/taskDraft.test.ts`、`app/test/taskOverview.test.ts`、`app/test/taskBar.test.ts`。测试目录不参与模块边界检查，直接测纯逻辑。

**注意**

- 待办允许没有截止时间，归入「待安排」；这个状态用 `hasDue` 显式表达，不要靠空字符串猜。
- 待办编辑页不展示手动优先级和关联日程，字段结构与日程页保持一致；备注、重复、提醒、地点和详细地址都保留。
- 待办页从上到下固定为：任务总览 → 待安排 → 任务 → 已完成；哪一组没有内容，整组标题和卡片都不显示。
- 全部为空时只显示「目前还没有待办哦」和右下角新建按钮，不保留空分组。
- 任务总览只统计有日期的安排；日程加载未来一年实例，全部未完成待办不受时间窗口限制。
- 红 / 橙 / 绿按剩余时间划分：未来 48 小时内为红，48 小时到一周为橙，一周后为绿；逾期项仍留在待办列表，但不进入三色任务条；色条不再承担筛选入口，点整行进入编辑页或日程详情。
- 没有截止时间（或截止时间无法解析）的待办固定归入「待安排」；该分组为空时不显示。
- 待办和日程都能点每行最右侧圆圈完成；已完成待办收在页面最底部的「已完成」区，点勾选可恢复为待办。日程的完成状态按身份、按重复实例分别保存。
- 勾掉日程后要调用 `refreshLocalReminders`：服务端不会再给已完成实例排提醒，若不对齐本机排期，手机里已经排好的那条仍会响。
- 通知栏 / 锁屏总览与「到点提醒」是两个开关；前者是持续通知，后者到点才响。Android 优先使用
  `ChronoflowTaskBar` 原生 RemoteViews 绘制三色卡片；原生更新失败时自动退回 `expo-notifications`。
- 数据仍是两张表（同屏合并视图），但完成状态已经打通；任一侧写入后，回到页面会重新拉取两边数据。
- 重复规则空串表示「不重复」；PATCH 里 `null` 表示「不修改」，两者不能混。
- 提醒不挂在待办行上，编辑页需要单独拉取并保存 `GET/PUT /reminders`。
- 本阶段只搬文件、拆边界，API 端点仍集中在 `app/src/api/endpoints.ts`；下一步再拆模块级 `api.ts`。
