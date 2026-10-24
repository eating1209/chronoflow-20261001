# shared · 共享底座

**管什么**：所有业务模块与页面都会用到、且不依赖具体业务域的基础能力。

**边界规则**

- `shared/` **不得直接 import `app/src/modules/`**；由 `npm run check:boundaries` 强制。
- 模块只能走 `shared/*/index.ts` 这类公开入口；`shared/notifications/availability.ts` 因依赖 Expo/RN，作为窄入口单独放行。
- 纯逻辑文件不能顶层 import React Native / Expo 原生模块，否则 Node 单测会起不来。

**目录**

```
shared/
├── api/            请求客户端、契约类型、发布信息
├── auth/           会话、令牌存储、组织账号记录、旧存储键迁移
├── ui/             页面骨架、卡片、表单、列表
├── notifications/  通知偏好、声音档位、原生可用性
├── location/       系统定位与定位来源退化
├── theme/          设计令牌主题与深色偏好
├── permission.ts   RN 权限申请适配层
├── permissions.ts  权限用途说明与纯判定
├── errors.ts       错误映射
└── types/          共享类型声明
```

**留在应用装配层的文件**

- `app/src/api/endpoints.ts`：业务端点很多，且要引用 ops 模块的功能开关类型，暂作为装配层保留。
- `app/src/auth/consentStore.ts`：依赖 compliance 模块的同意纯逻辑，暂作为应用级存储保留。
- `app/src/context/AppContext.tsx`：全局状态与运行时组装。
- `app/src/runtime.ts`：API、会话、通知排期的运行时装配。
- `app/src/App.tsx`：导航与应用根组件。

这些文件可以依赖 `modules/`，反向依赖不允许。
