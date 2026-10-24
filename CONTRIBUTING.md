# 团队协作规范

这个仓库接下来由多人共同开发。目标是：每个人只改自己负责的模块，接口和合入过程可验证，避免互相踩文件。

## 一、仓库与分支

- 仓库使用 **Private**，不要公开敏感配置、审核账号、服务器信息和用户数据。
- `main` 是稳定分支，不直接提交；每个人从 `main` 拉功能分支。
- 分支命名：`feat/<模块>-<做什么>`，例如 `feat/tasks-assignment`、`feat/notifications-alarm`。
- 修 bug 用 `fix/<模块>-<问题>`；文档用 `docs/<主题>`。
- 一个 PR 只做一件事；跨模块需求拆成多个 PR，先改契约和后端，再改 App / Web。

## 二、模块 ownership

模块划分见 `docs/05-技术/模块索引.md`；六人分工见 `docs/01-产品/六人分工-2026-10-24.md`。

- 每个模块同一时间只有一个 owner。
- 模块之间只能从 `index.ts`、`pure.ts`、`components.ts` 导入，不能进别人的 `screens/`、`domain/`、`components/` 内部。
- `shared/` 是公共底座，不允许反向依赖 `modules/`。
- 改公共层或跨模块接口，至少找一位模块 owner review。
- 拿到 GitHub 用户名后，把 owner 写进 `.github/CODEOWNERS`，开启分支保护。

## 三、接口与后端同步

- `contract/api-contract.json` 是跨语言接口清单；改接口必须同时更新 Java、Python、App/Web 客户端和 `spec.md`。
- Java 与 Python 的行为必须一致，契约测试是合并门禁。
- 数据库迁移由 Flyway 管理，不要手改已发布的迁移文件；新增迁移先确认数据留存和删除口径。

## 四、提交前检查

```bash
# App 类型检查与单测
npm run typecheck -w @chronoflow/app
npm test -w @chronoflow/app

# Web 后台
npm run test -w @chronoflow/web-admin

# 模块边界
npm run check:boundaries

# 合规门禁（涉及隐私、权限、SDK、备案时必跑）
python3 scripts/check_compliance.py --strict
```

后端改动另跑：

```bash
cd backend-java && mvn -o test
cd ../backend-python && .venv/bin/python -m pytest tests -q
```

## 五、不要提交的内容

- `.env`、`.env.*`、任何真实密钥/口令/Token
- `*.pem`、`*.key`、`*.jks`、`*.keystore`、`*.p12`、`*.mobileprovision`
- 审核账号、固定验证码、客服电话/邮箱等真实联系方式
- 服务器 SSH 地址、生产数据库连接串、第三方平台 Secret
- 用户数据、上传文件、构建产物和 `node_modules`

需要给团队共享的配置写在 `.env.example`，真实值放到服务器环境变量、GitHub Actions Secrets 或团队密码管理器。

## 六、PR 检查清单

- [ ] 只改了自己负责的模块；跨模块改动已拆分并说明
- [ ] 接口变化已同步契约、Java、Python 和客户端
- [ ] 新增权限 / SDK / 数据收集已同步隐私文本和备案说明
- [ ] 相关测试、typecheck、边界检查通过
- [ ] 没有提交密钥、真实账号或生产环境信息
- [ ] PR 描述写清楚：改了什么、为什么改、怎么验收、影响哪些端

