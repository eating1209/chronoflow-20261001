## 目标分支

- [ ] `feature/*` → `develop`
- [ ] `develop` → `test`
- [ ] `test` → `pre-release`
- [ ] `pre-release` → `main`
- [ ] `hotfix/*` → `main`（并回 `develop`）

## 改了什么


## 为什么改


## 怎么验收


## 影响范围

- [ ] App
- [ ] Web 后台
- [ ] Java 后端
- [ ] Python 后端
- [ ] 契约 / 数据库迁移
- [ ] 隐私、权限、SDK 或备案材料

## 提交前检查

- [ ] 只改了自己负责的模块，没有直接改 `main` / `test` / `pre-release`
- [ ] 接口变化已同步契约、Java、Python 和客户端
- [ ] 相关测试、typecheck、边界检查通过
- [ ] 涉及隐私 / 权限 / SDK 时已跑合规检查
- [ ] 没有提交密钥、真实账号、生产地址或用户数据
