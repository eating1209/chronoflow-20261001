# compliance 模块 · 合规

**管什么**：首次启动的隐私政策同意页、用户协议/隐私政策/儿童声明/双清单的 WebView 展示，以及同意状态与法律文档入口的纯逻辑。

**对外出口**

| 入口 | 用途 |
| --- | --- |
| `index.ts` | `LegalScreen`、`PrivacyConsentScreen` 两个页面，并转出纯逻辑 |
| `pure.ts` | 同意判定、隐私政策版本、法律文档元信息与 URL；供 App、身份模块、存储层和单测使用 |

**目录**

```
compliance/
├── domain/consent.ts   首启同意、登录同意门禁（纯逻辑）
├── domain/legal.ts     四份法律文档的标题、URL 与运营主体（纯逻辑）
├── screens/LegalScreen.tsx
├── screens/PrivacyConsentScreen.tsx
├── pure.ts             纯逻辑公开出口
└── index.ts            页面公开出口
```

**依赖谁**：`shared/ui`、`context/AppContext`、`react-native-webview`、后端 `GET /api/v1/legal/{doc}`。

**谁依赖它**：`App.tsx`、`modules/identity`、`modules/ops`、`auth/consentStore`。

**测试**：`app/test/compliance.test.ts`，测试只 import `modules/compliance/pure`。

**注意**

- 隐私政策正文不内嵌在 App 里，必须与商店提交的链接同源，避免两份文本漂移。
- 同意不得默认勾选；拒绝后可以退出应用，但不能偷偷收集信息。
- 隐私政策版本升级后会重新征求同意，见 `PRIVACY_POLICY_VERSION`。
