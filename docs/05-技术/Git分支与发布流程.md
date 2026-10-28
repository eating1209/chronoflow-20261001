# Git 分支与发布流程

> 目标：原始版本永久可查；开发、测试、预发布、正式上架互不覆盖。
> 六个人都按这份文档操作，不再直接往 `main` 提交。

## 一、分支总览

| 分支 | 用途 | 允许谁合入 | 规则 |
| --- | --- | --- | --- |
| `main` | 正式上架 | 技术负责人 | 受保护；只接受 `pre-release` 的 PR；每次上架打版本 tag |
| `pre-release` | 预发布 / 验收 | 技术负责人 | 受保护；只接受 `test` 的 PR；验收通过才能进 `main` |
| `test` | 测试 / 联调 | 测试负责人 | 只接受 `develop` 的 PR；在这里跑回归和真机测试 |
| `develop` | 日常开发主链 | 模块负责人 | 默认分支；所有 `feature/*` PR 合到这里 |
| `feature/*` | 每人、每个任务的支链 | 开发者本人 | 从 `develop` 拉，完成后 PR 回 `develop` |
| `hotfix/*` | 线上紧急修复 | 技术负责人 | 从 `main` 拉，修完同时合回 `main` 和 `develop` |

完整流向：

```text
feature/* ──> develop ──> test ──> pre-release ──> main
                                      │
                                   验收通过

main ──> hotfix/* ──> main
                 └──> develop
```

## 二、原始版本怎么保留

仓库已经打了两个不会移动的 tag：

| tag | 指向 | 用途 |
| --- | --- | --- |
| `original-import` | 最初导入项目的提交 | 永远可以找回老师最初看到的版本 |
| `baseline-2026-10-25` | 开始分叉前的 `main` | 本轮团队开发的共同起点 |

不要删除、移动或重写这两个 tag。查看原始版本：

```bash
git show original-import --stat
git switch --detach baseline-2026-10-25
```

## 三、同学每天怎么开发

第一次拿到仓库：

```bash
git switch develop
git pull origin develop
```

每个任务新建一条支链，**不要从 `main` 拉功能分支**：

```bash
git switch develop
git pull origin develop
git switch -c feature/<姓名>-<模块>-<做什么>
```

例如：

```text
feature/huangxin-filing-materials
feature/wangjing-share-entry
feature/yanlong-ios-build
```

提交和推送：

```bash
git add <只添加自己改的文件>
git commit -m "feat(tasks): add assignment entry"
git push -u origin feature/huangxin-filing-materials
```

然后在 GitHub 发 PR，**base 选 `develop`**。PR 通过 CI 和至少一位同学 review 后再合并。

## 四、发布怎么走

### 1. 开发完成

`feature/*` 全部合回 `develop`，CI 通过。

### 2. 进入测试

负责人发 PR：`develop -> test`。测试同学在 `test` 上做联调和回归，问题用 `fix/*` 分支修，修完合回 `develop`，再由负责人同步到 `test`。

### 3. 进入预发布

测试通过后发 PR：`test -> pre-release`。在预发布环境做验收、截图、安装包检查；**不要在预发布分支上直接改功能**。

### 4. 正式上架

验收通过后发 PR：`pre-release -> main`，然后打 tag：

```bash
git switch main
git pull origin main
git tag -a v1.1.0 -m "时纪流 1.1.0 正式上架"
git push origin main
git push origin v1.1.0
```

正式安装包必须从 `main` 或版本 tag 构建，不要从 `develop` / `feature` 直接出上架包。

## 五、线上急救

正式版本出问题时，从 `main` 拉 `hotfix/*`：

```bash
git switch main
git pull origin main
git switch -c hotfix/<问题>
```

修完合回 `main` 并打补丁版本 tag，同时必须合回 `develop`，否则下次开发会把问题带回来。

## 六、GitHub 上要手动打开的设置

进入仓库 **Settings → Branches / Rules**：

1. 把默认分支改成 `develop`。
2. 对 `main`、`pre-release`、`test` 开启保护：
   - 禁止直接 push；
   - 合并必须走 Pull Request；
   - 至少 1 人 approve；
   - CI 必须通过；
   - 禁止 force push 和删除分支。
3. 给六位同学分配写权限，但只有技术负责人能合并到 `pre-release` 和 `main`。

GitHub 用户名收齐后，再补 `.github/CODEOWNERS`，让每个模块自动找对应负责人 review。

## 七、几条硬规则

- 不直接改 `main`、`pre-release`、`test`。
- 一个 PR 只做一件事；跨模块需求拆成多个 PR。
- 分支名用英文小写和短横线，不用中文和空格。
- 不要提交 `.env`、keystore、口令、生产地址和用户数据。
- 合并前必须过 CI；涉及隐私、权限、SDK、备案时另跑 `python3 scripts/check_compliance.py --strict`。
- 原始 tag 只读保留，不删除、不覆盖。

## 八、第一次把分支推到 GitHub

```bash
git push -u origin develop test pre-release
git push origin main
git push origin original-import baseline-2026-10-25
```

推送后到 GitHub 仓库首页确认四个长期分支和两个 tag 都在，再按第六节打开保护规则。
