# asr —— 语音输入（长按说话 → 日程草稿）

> 任务 10「语音识别功能，提取日程」（spec §4.1.9.1）。
> **只走云端**：阿里云百炼 `qwen3-asr-flash`。离线识别已于 2026-11-01 移除。

## 链路

```
日历页「识别日程」→「语音输入」
   ↓
按住说话（16 kHz 单声道 PCM WAV，最长 30 秒，上滑取消）
   ↓
POST /api/v1/ai/transcribe（我们的服务端 → 阿里云百炼）
   ↓
繁转简 + 归一化 → 可编辑的转写文字（用户核对 / 修改，不自动提交）
   ↓
POST /ai/events/parse-text（与拍照识别同一条）
   ↓
EventImportScreen 确认页 → 逐条写进日历
```

**语音需要联网**：断网、服务端未配置或超时都会直接报错，没有本地兜底。
提示语会明确说「语音需要联网」，并建议直接输入文字。

## 目录

| 路径 | 职责 |
| --- | --- |
| `domain/asr.ts` | 通道标识、失败话术（纯逻辑） |
| `domain/holdToTalk.ts` | 按住 / 录音 / 上滑取消 / 太短的状态机（纯逻辑） |
| `domain/transcript.ts` | 转写文字归一、空 / 超长校验（纯逻辑） |
| `domain/chinese.ts` | 繁体 → 简体（内置常用字映射，不额外引入依赖） |
| `engines/cloud.ts` | 云端通道（只依赖 `api.transcribeAudio`） |
| `recording/pcmRecorder.ts` | 原生录音模块的 JS 适配层 |
| `screens/VoiceInputScreen.tsx` | 按住说话页面（五态） |
| `service.ts` | 编排：上传、超时、繁转简、错误归一 |

## 录音格式

优先使用 `app/plugins/withPcmRecorder.js` 注入的 16 kHz 单声道 WAV 模块；
如果安装包里没有这个原生模块，会自动退回 `expo-audio` 录 m4a。
云端 `qwen3-asr-flash` 两种格式都接受，所以不会因为录音格式卡住功能。

## 中文输出

云端通常返回简体，但偶尔仍会出繁体（尤其人名 / 地名）。`domain/chinese.ts`
在 `service.ts` 里把结果统一转成简体；转换失败保留原文，不影响识别。

## 隐私边界

- 录音**只用于这一次转写**，转完立即删除；不保存、不做声纹识别、不进训练数据；
- 云端通道：音频经我们的服务端（内存中转 base64）转发百炼，**不落盘**；
- 因此语音功能**必须联网**，且录音会离开手机（隐私政策 §2.7.1 已如实披露）。

## 离线识别为什么移除（2026-11-01）

真机实测（vivo V2031EA / Android 10）：

- Whisper base 中文**输出繁体**，3 秒音频约 **8.7–9.7 秒**；
- 准确率达不到可用水平，且模型给 APK 增加约 59MB；
- 产品决定：与其保留一个「能用但不好用」的兜底，不如断网时如实提示，
  把云端准确率作为唯一标准。

代码层面已删除 `whisper.rn` 依赖、`engines/whisper.ts`、`engines/onDevice.ts`、
`engines/register.ts`、`scripts/fetch_asr_models.sh` 与模型文件。
要恢复需重新引入上述依赖与模型，并把 `service.ts` 的编排改回多通道。

## 测试

纯逻辑单测在 `app/test/asr.test.ts`（`npm test -w @chronoflow/app`）。
录音、真实转写必须在真机 / 模拟器上验。
