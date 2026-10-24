# org 模块 · 组织

**管什么**：组织 tab、组织日程查看、组织日程下发与编辑、下发对象选择、组织账号认领，以及下发表单和选人逻辑。

**对外出口**：`index.ts`（别的模块和 App 只能从这里 import）

| 导出 | 用途 |
| --- | --- |
| `OrgTabScreen` | 组织 tab，处理未绑定/待认领/已有令牌三种状态 |
| `OrgEventsScreen` | 组织日程月历与当日列表 |
| `OrgEventEditorScreen` | 新建 / 编辑组织日程并下发 |
| `OrgRecipientPickerScreen` | 按二级单位分组、搜索、整组勾选的选人页 |
| `OrgAccountsScreen` | 已认领组织账号列表与切换 |
| `canDispatch` / `validateDispatchForm` | 下发权限判断与表单校验 |
| `buildDispatchPayload` / `buildUpdatePayload` | 生成服务端请求体 |
| `buildRecipientGroups` / `filterRecipientGroups` | 选人分组与搜索 |
| `toggleId` / `addIds` / `removeIds` / `selectedSummary` | 多选与已选摘要 |

**目录**

```
org/
├── domain/orgDispatch.ts    下发表单、校验、请求体映射（纯逻辑）
├── domain/orgRecipients.ts  选人分组、搜索、整组勾选（纯逻辑）
├── screens/                 5 个组织相关页面
└── index.ts                 唯一公开出口
```

**依赖谁**：`shared/ui`、`shared/api`、`shared/errors`、`shared/auth`、`context/AppContext`，
以及 `modules/calendar/pure`（时间转换）和 `modules/calendar/components`（月历、日期滚轮）。

**谁依赖它**：`App.tsx`（注册组织 tab 与编辑页）。

**测试**：`app/test/orgDispatch.test.ts`、`orgRecipients.test.ts`。测试直接 import 纯逻辑文件；
`orgAccounts.test.ts` 测的是共享的 `shared/auth`，不属于本模块。

**注意**

- 下发对象始终是成员级名单（`scopeType=MEMBER` + `memberIds`），不做“全组织/部门”的抽象粒度。
- 可选范围由 `/org/current` 的 `manageableDepartmentIds` 决定；无下发权限的人必须不出现。
- 每个组织账号有独立令牌，组织页切换组织时请求客户端要整套切换。
