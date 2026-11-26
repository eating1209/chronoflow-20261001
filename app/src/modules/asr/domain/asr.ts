/**
 * 语音输入（长按说话）的纯逻辑：**通道标识**与**失败话术**。
 *
 * <p>2026-11-01 用户决定：**只保留云端识别**（阿里云百炼 `qwen3-asr-flash`）。
 * 离线 Whisper 已整体移除——它在真机上中文输出繁体、3 秒音频约 9 秒、
 * 准确率也达不到可用水平，与其保留一个「能用但不好用」的兜底，不如
 * 在断网时如实告诉用户「语音需要联网」，并给手工输入这条路。
 *
 * <p>这一段必须是纯函数：错误话术可以在 node 里单测，不需要麦克风与网络。
 */

/** 语音转文字的通道。目前只有云端；保留类型是为了以后新增通道时不改调用方。 */
export type AsrChannel = 'cloud';

export interface AsrResult {
  /** 已归一化并转成简体的文字（见 domain/transcript.ts、domain/chinese.ts） */
  text: string;
  language: string | null;
  channel: AsrChannel;
  /** 转写本身花了多久（不含录音） */
  elapsedMs: number;
}

/** 一次失败的尝试。失败原因只用于拼给用户看的提示，不暴露错误码。 */
export interface AsrAttemptFailure {
  channel: AsrChannel;
  message: string;
}

export function channelLabel(_channel: AsrChannel): string {
  return '云端识别';
}

/**
 * 转写失败时给用户的一句话。
 *
 * <p>语音现在**必须联网**：断网 / 服务端未配置 / 超时都没有本地兜底。
 * 提示里要说清这一点，并给出可执行的退路（检查网络、直接输入文字）。
 */
export function describeFailure(failures: AsrAttemptFailure[]): string {
  if (failures.length === 0) {
    return '语音转文字没有成功，请检查网络后重试，或直接把文字打出来。';
  }
  const detail = failures.map((failure) => failure.message).join('；');
  return `语音转文字没有成功（${detail}）。语音需要联网使用，请检查网络后重试，或直接把文字打出来。`;
}
