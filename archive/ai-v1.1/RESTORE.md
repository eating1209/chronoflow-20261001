# 「小安」AI 对话 —— 下线留档与恢复说明

**下线日期**：2026-10-19
**下线时的版本**：时纪流 1.1.0（versionCode 15）
**上线版本**：1.1.0（versionCode 16，不含 AI 对话）

## 为什么下线

应用宝把「AI 机器人对话」列为特殊行业，提审必须提供：
① 互联网信息服务安全评估报告 + 公安平台提交结果；② 身份校验；③ 深度合成标识；
④ 算法备案（`beian.cac.gov.cn`）。备案 + 评估合计 1–3 个月。
为了先上架，本版本把对话能力整体摘掉；资质齐了再恢复。

**注意：「图片识别日程」用的是同一家模型（阿里云百炼 / 通义千问），但那是文字解析不是对话，
不在特殊行业范围内，所以保留。** 恢复时不要把它的披露一起删掉/加错。

## 这里备份了什么

| 路径 | 内容 |
| --- | --- |
| `app/src/App.tsx` | 下线前的 App 入口（含小安 tab 的渲染块） |
| `app/src/screens/` | `AgentChatScreen.tsx`、`agentMic.tsx`、`agentMicImpl.tsx` |
| `app/src/components/` | `AgentMarkdown.tsx`、`permission.ts`（录音申请分支） |
| `app/src/api/agent.ts` | 对话流与授权答复的接口 |
| `app/src/domain/` | `agent.ts`、`agentActions.ts`、`agentMarkdown.ts`、`agentStream.ts`、`permissions.ts`（含麦克风话术） |
| `app/test/` | 四个 agent 单测（共 33 项） |
| `app-root/app.json` | 下线前的配置（含 `expo-audio` 插件，即 RECORD_AUDIO 权限） |
| `docs-legal/` | 下线前的隐私政策、两份清单、合规清单（含小安章节与语音声明） |
| `backend-java/` | 整个 `chronoflow-agent` 模块 + `prompt.md`（后端侧没动，一直在线） |

## 恢复步骤（按顺序）

1. 把 `app/src/**` 下的文件按原路径拷回：
   ```bash
   cp -r archive/ai-v1.1/app/src/. app/src/
   cp archive/ai-v1.1/app/test/*.ts app/test/
   ```
2. `app/app.json`：把 `expo-audio` 插件加回 `plugins`（内容见 `archive/ai-v1.1/app-root/app.json`），
   否则语音输入没有录音能力。
3. `app/src/domain/features.ts` 里的 `agent` 开关一直在（下线时没删），无需改动。
4. **法律文本必须同步恢复**（这是最容易漏的）：
   - `docs/legal/privacy-policy.md`：恢复 §2.10 小安章节、§4.1 第 4 项、§6.2 两行、
     §7.3 麦克风那句、§9.1 百炼「对话」行、§9.2 麦克风权限行
   - `docs/legal/personal-info-collected.md`：恢复 19/20 两行并重新编号
   - `docs/legal/shared-info-with-third-parties.md`：恢复「智能助手」那一行并重新编号
   - 直接用 `archive/ai-v1.1/docs-legal/` 里的原件覆盖，再手工把期间新增的条目合并回来
5. `scripts/check_compliance.py` 的 `check_ai_feature_scope` 要改回「必须包含小安声明」的断言。
6. 前端 `app/src/screens/SettingsSectionScreen.tsx` 的第三方共享清单副标题本来就含「通义千问」，
   恢复后不用改；如果当初删了极光推送，记得补回。
7. versionCode 递增、重新出包、发布。

## 恢复前必须先具备

- [ ] 算法备案号（`网信算备 xxx 号`）已拿到，并已公示在 App 内（「我的 → 关于」+ 对话页底部）
- [ ] 公安安全评估报告已提交并拿到结果截图
- [ ] 小安每条回复下已加「内容由 AI 生成，仅供参考」（深度合成标识）
- [ ] 应用宝「特殊行业资质评估」里已上传上述材料
