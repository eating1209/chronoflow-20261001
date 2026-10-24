# calendar 模块 · 日程

**管什么**：月历与今日安排、日程新建/编辑、地点选择、重复规则、提醒选择、图片识别结果确认入口，以及日期与草稿相关的纯逻辑。

**对外出口**：三个公开入口，其他模块只能从这里 import：

| 入口 | 用途 |
| --- | --- |
| `index.ts` | 六个页面：`AgendaScreen`、`EventEditorScreen`、`EventPickerScreen`、`LocationPickerScreen`、`RecurrencePickerScreen`、`ReminderPickerScreen` |
| `pure.ts` | 纯逻辑：日期网格与格式化、草稿转换、节假日、RRULE、检索展示、滚轮计算、二级页回传类型 |
| `components.ts` | 可复用组件：`MonthCalendar`、`Wheel*`、`MapPicker` |

**目录**

```
calendar/
├── domain/         纯逻辑，可在 Node 里单测
├── screens/        六个日程相关页面
├── components/     月历、滚轮、地图选点
├── pure.ts         纯逻辑公开出口（给 tasks / vision / notifications / 测试）
├── components.ts   组件公开出口（给组织日程、待办编辑）
└── index.ts        页面与完整能力出口
```

**依赖谁**：`shared/ui`、`shared/api`、`shared/errors`、`shared/location`、`context/AppContext`，
以及 `modules/vision`（图片识别入口）和 `modules/notifications`（提醒排期与声音档位）。

**谁依赖它**：`App.tsx`、`modules/tasks`、`modules/vision`、`modules/notifications`、`modules/org`。

**测试**：`agenda.test.ts`、`calendar.test.ts`、`eventDraft.test.ts`、`holiday.test.ts`、`recurrence.test.ts`、`searchResult.test.ts`、`wheelDate.test.ts`、`wheelTime.test.ts`、`orgDispatch.test.ts`、`vision.test.ts`、`taskDraft.test.ts`。测试只 import `modules/calendar/pure`，不会把 React Native 页面带进 Node 环境。

**注意**

- 提醒的排期、通知渠道和声音档位在 `modules/notifications`，不在本模块；本模块只负责选择结果与编辑页。
- `editorSelection.ts` 用结构化的 `ReminderSoundChoice`，不要改成 import `notifications` 的`ReminderSound`，否则会形成纯层循环依赖。
- 日期加减一律走 UTC；展示时显式传 `APP_TIMEZONE`，不要依赖设备时区。
- `eventDraft` 是日程与待办的共享草稿能力：改字段时同时检查待办、识别确认页和组织日程的请求体映射。
