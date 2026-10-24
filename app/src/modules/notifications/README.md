# notifications 模块 · 通知、提醒与更新

**管什么**：本地到点提醒、提醒声音档位、提醒设置保存与重排、通知点击路由，以及应用内更新检查、APK 下载和更新弹窗。

**对外出口**：`index.ts`（页面和 App 只能从这里 import）

| 导出 | 用途 |
| --- | --- |
| `AppUpdateProvider` / `useAppUpdate` | 启动时检查更新、手动检查、更新弹窗 |
| `decideUpdate` / `resolveApkUrl` 等 | 版本比较、下载地址、更新文案（纯函数） |
| `persistReminderSettings` / `refreshLocalReminders` | 保存提醒、按服务端清单重排本机通知 |
| `schedule*` / `planReminders` / `normalizeReminders` | 提醒排期与提前量工具 |
| `DEFAULT_REMINDER_SOUND` / `describeReminderSound` | 静音 / 消息提醒 / 闹钟三档声音 |
| `subscribeNotificationResponses` / `routeFrom...` | 点击本地通知后的导航意图 |

**目录**

```
notifications/
├── actions.ts              保存提醒 + 对齐本机排期
├── availability.ts         当前环境有没有 expo-notifications
├── expoGateway.ts          唯一的 expo-notifications 原生适配层
├── listener.ts             监听运行中 / 冷启动的通知点击
├── prefs.ts                通知总开关与默认声音（本机安全存储）
├── reminderStore.ts        本机通知 id 账本
├── resync.ts               服务端排期 → 本机排期
├── route.ts                通知 data → 页面路由
├── scheduler.ts            排期、取消、对账（纯逻辑可单测）
├── sound.ts                三档声音与 Android 渠道 id
├── domain/reminderSchedule.ts  提前量、时区与通知正文
├── domain/appUpdate.ts     更新判定与文案
├── screens/AppUpdater.tsx  更新弹窗与系统安装器调用
└── index.ts                唯一公开出口
```

**依赖谁**：`shared/api`、`shared/ui`、`shared/notifications`、`modules/calendar/pure`、
全局 Context 和 `shared/permission`。

**测试**：`app/test/` 下的 `reminder*.test.ts`、`notificationRoute.test.ts`、`appUpdate.test.ts`。
这些测试直接 import 纯逻辑文件；不引入 React Native 页面。

**注意**

- Android 通知声音由渠道决定，渠道建好后不能改声音，所以三档 = 三个渠道 id，**不要改字符串**。
- 通知只做用户主动设置的前台本地提醒，不做后台常驻录音或后台监听。
- `AppUpdater` 只在 Android 下载 APK；iOS 走商店升级。下载完成后交给系统安装器，不静默安装。
- 通知偏好与声音档位已移到 `shared/notifications`；`context/AppContext`、`runtime.ts`、`shared/permission.ts` 直接依赖共享底座，不再反向引用本模块内部文件。
