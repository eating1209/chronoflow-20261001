# Android 出包与验收（成员 6）

> 更新时间：2026-10-26
> 当前包：`1.1.0` / `versionCode 19`，包名 `com.chronoflow.frontend`。
> 本文件只写“怎么出包、怎么验、交什么”，不把构建产物提交进 Git。

## 一、发版前先定版本号

只要这次包要上传商店或替换线上包，`versionCode` 必须比上一版大。

| 项 | 位置 | 当前值 | 下次发版 |
| --- | --- | --- | --- |
| versionName | `app/app.json` 的 `expo.version` | `1.1.0` | 按产品决定，例如 `1.2.0` |
| versionCode | `app/app.json` 的 `expo.android.versionCode` | `19` | 至少 `20`，只能递增 |
| 包名 | `app/app.json` 的 `expo.android.package` | `com.chronoflow.frontend` | 不要改；改了等于新应用，要重做备案和商店资料 |
| API / 隐私政策地址 | `app/app.json` 的 `expo.extra.apiBaseUrl` | `https://chronocloud.top` | 不变 |

改完版本号后，同步更新商店文案、提审清单、更新说明和 `docs/03-上架/应用宝提审清单.md`，避免“包的版本和后台填的版本不一致”。

## 二、出包命令

在仓库根目录执行：

```bash
npm ci
npm test -w @chronoflow/app
npm run typecheck -w @chronoflow/app
npm run check:boundaries
python3 scripts/check_compliance.py --strict

bash scripts/build_apk.sh --prebuild --release --archs=arm64-v8a
bash scripts/check_apk.sh
```

说明：

- `--prebuild` 用于 `app.json` 改过（版本号、权限、插件、包名）的情况；只改 JS 代码可以先不 prebuild，但发版建议 prebuild。
- 真机商店包只需要 `arm64-v8a`；模拟器调试才用 `x86_64`。不要把自己模拟器的包传到商店。
- 正式签名依赖 `CHRONOFLOW_KEYSTORE`、`CHRONOFLOW_KEY_ALIAS`、`CHRONOFLOW_STORE_PASSWORD`、`CHRONOFLOW_KEY_PASSWORD` 四个环境变量。没有 keystore 就不要出正式包。
- 构建脚本会把 `app.json` 的版本钉进 `build.gradle`，但仍要用 `check_apk.sh` 复核，不能只看文件名。

## 三、必须核对的包信息

`check_apk.sh` 通过后，再人工确认：

- 包含 `arm64-v8a`，没有把模拟器专用 x86_64 包传商店；
- 包名 `com.chronoflow.frontend`；
- versionName / versionCode 与商店后台、更新接口一致；
- 签名有效，证书 MD5 / SHA-256 与备案和极光后台一致；
- 不含后台定位、读取手机状态、读取应用列表、录音、悬浮窗等高危权限；
- 16KB 页对齐通过（Android 15+ 机型）；
- APK 能在至少一台真机安装并打开，不是只装进模拟器。

## 四、Android 12–16 通知验收

本版本的通知动作已经实现：日程通知有“稍后 10 分钟”，待办通知有“稍后 10 分钟”和“完成”。测试时每种状态都要点一遍：

| 场景 | 预期 |
| --- | --- |
| 锁屏 | 到点弹出通知；点通知打开对应日程 / 待办 |
| 亮屏前台 | 仍能看到通知，不被前台吞掉 |
| App 在后台 | 到点正常弹出 |
| App 被划掉 | 本地通知仍能按时触发（受厂商省电策略影响时记录机型） |
| 点“稍后 10 分钟” | 10 分钟后再次提醒；前台重排不会把这条稍后通知误删 |
| 待办点“完成” | 服务端待办变为已完成，该待办的普通提醒和稍后提醒都取消 |
| 静音档 | 通知栏可见，不响、不震动 |
| 消息档 | 响一声并震动 |
| 闹钟档 | 按闹钟音量响，尽量绕过免打扰；在小米 / 华为等机型记录是否被省电策略拦截 |
| 关闭通知总开关 | 已排通知被撤销，之后不再提醒 |

至少覆盖 Android 12、13、14、15、16 各一台真机或云真机；记录品牌、型号、系统版本、截图和复现步骤。

## 五、Android 大图通知的限制（必须如实说明）

当前使用 `expo-notifications` 的本地通知能力，**没有可用的 Android 大图（BigPicture）字段**。目前实现的是：

- 标题、时间、地点等完整展开文本；
- “稍后 10 分钟”“完成”动作按钮；
- 三种声音渠道和点击直达。

如果验收要求严格到“Android 通知里必须显示大图”，只改 JS 不够，需要写自定义 Android 原生通知模块（`RemoteViews` / `BigPictureStyle`），并重新做原生构建与兼容测试。不要在验收表里把这一项勾成已完成。

## 六、交给商店 / 备案的材料

| 材料 | 来源 | 交给谁 |
| --- | --- | --- |
| arm64 APK | `scripts/build_apk.sh` 产物 | 成员 3 / 成员 4 |
| versionName / versionCode | `app/app.json` | 成员 3 / 成员 4 |
| 签名 MD5 / SHA-256 | `apksigner verify --print-certs` | 成员 3（备案变更） |
| 更新说明 | 本次改动摘要 | 成员 4 写商店文案 |
| 包名、SDK 清单、功能描述 | 最终 APK 与 `app.json` | 成员 3（备案） |
| 隐私政策 / 已收集清单 / 第三方共享清单 | `docs/legal/` 对应后端版本 | 成员 4 |
| 通知测试记录 | 本文件第四节的表格 | 成员 3 回归验收 |

## 七、不要做的事

- 不要用 debug 包或模拟器包上传商店；
- 不要换 keystore 后不通知备案和极光后台；
- 不要把 `android/` 构建产物、APK、keystore、口令提交进 Git；
- 不要在未跑 `check_apk.sh` 和隐私合规检查的情况下提审；
- 不要把 `versionCode` 改小或重复使用。
