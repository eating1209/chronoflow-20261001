# ops 模块 · 运维运营

**管什么**：「我的」主页、账号与安全/偏好/支持/关于等分类子页、意见反馈，
以及反馈校验、媒体地址拼接、后台功能开关的客户端口径。

**对外出口**

| 入口 | 用途 |
| --- | --- |
| `index.ts` | `SettingsScreen`、`SettingsSectionScreen`、`FeedbackScreen` 与分类类型 |
| `pure.ts` | 反馈文案/校验、`absoluteMediaUrl`、功能开关解析；供 App、API 类型和单测使用 |

**目录**

```
ops/
├── domain/feedback.ts  反馈分类、状态文案、提交前校验（纯逻辑）
├── domain/media.ts     相对媒体 URL → 绝对地址（纯逻辑）
├── domain/features.ts  后台功能开关解析与默认值（纯逻辑）
├── featureFlags.ts     功能开关的进程内缓存与 useFeatureFlags
├── screens/            「我的」主页、分类子页、意见反馈
├── pure.ts             纯逻辑公开出口
└── index.ts            页面与分类类型公开出口
```

**依赖谁**：`shared/ui`、`shared/api`、`shared/errors`、`shared/permission`、
`context/AppContext`、`modules/identity`、`modules/notifications`、`modules/compliance/pure`。

**谁依赖它**：`App.tsx`（注册「我的」与反馈页）、`api/endpoints.ts`（功能开关类型）。

**测试**：`app/test/feedback.test.ts`、`media.test.ts`、`features.test.ts`，测试只 import `modules/ops/pure`。

**注意**

- 功能开关读不到一律按「开」，一次网络抖动不能把反馈、实名等入口藏起来。
- 媒体 URL 必须用 `absoluteMediaUrl` 拼当前 API 地址，否则头像/反馈图会显示为空。
- 反馈只展示「待处理 / 已处理」，不向用户暴露后台处理过程。
