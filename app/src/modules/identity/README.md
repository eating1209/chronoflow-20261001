# identity 模块 · 账号身份

**管什么**：登录、注册、密码设置/重置、短信频控、换手机号、邮箱绑定、实名认证、资料、账号注销和头像裁剪。

**对外出口**：`index.ts`（页面和其他模块只能从这里 import）

| 导出 | 用途 |
| --- | --- |
| `LoginScreen` / `RegisterScreen` | 验证码登录、密码登录、注册 |
| `PasswordScreen` / `PasswordResetScreen` | 设置/修改密码、忘记密码 |
| `PhoneChangeScreen` / `EmailBindScreen` | 换绑手机号、绑定邮箱 |
| `RealNameScreen` / `AccountDeletionScreen` | 实名认证、账号注销 |
| `ProfileEditScreen` / `AvatarCropScreen` | 昵称、头像裁剪 |
| `passwordIssue` / `passwordsMatch` | 密码规则与二次确认 |
| `loginButtons` / `SMS_COOLDOWN_SECONDS` | 登录按钮状态与短信频控 |
| `displayName` / `maskPhone` | 昵称展示与手机号脱敏 |

**目录**

```
identity/
├── domain/                 纯逻辑：登录按钮、密码、短信频控、资料、头像裁剪
├── screens/                10 个身份相关页面
└── index.ts                唯一公开出口
```

**依赖谁**：`shared/ui`、`shared/auth`、`shared/errors`、`shared/permission`、
`context/AppContext`，以及 `modules/compliance/pure`（法律文档与同意判定）。

**测试**：`app/test/loginForm.test.ts`、`password.test.ts`、`smsCooldown.test.ts`、
`profile.test.ts`、`avatarCrop.test.ts`。测试直接 import 纯逻辑文件。

**注意**

- 手机号是登录凭证：换手机号必须同时验证新号和“本人”（旧号验证码或已绑定邮箱验证码）。
- 注销是不可逆操作：先展示后果、勾选确认，再二次确认；注销后组织成员记录保留，但个人数据删除。
- 密码只做客户端提示，最终规则以服务端校验为准；不要把密码写进日志或错误文案。
- 实名认证的 H5/iframe 需要 HTTPS 安全上下文，摄像头权限走 `shared/permission`。
- 会话、token 等共享基础设施在 `shared/auth`；同意记录存储仍在应用级 `auth/consentStore.ts`。
