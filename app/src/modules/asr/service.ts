/**
 * 语音转写：**只走云端**（2026-11-01 用户决定移除离线识别）。
 *
 * <p>链路：录音 → `POST /api/v1/ai/transcribe` → 文字。
 * 断网、服务端未配置、超时都没有本地兜底——直接报错，并提示用户
 * 「语音需要联网」或改用键盘输入。提示语里必须说清这一点，
 * 不能让用户以为「等一下就会好」。
 *
 * <p>超时是客户端加的：云端接口本身没有超时参数，弱网下 fetch 可能挂很久。
 * 20 秒足够一次 30 秒录音的上传 + 转写。
 */

import type { Endpoints } from '../../api/endpoints';
import { ApiError } from '../../shared/api';
import { userFacingMessage } from '../../shared/errors';
import { describeFailure, type AsrAttemptFailure, type AsrResult } from './domain/asr';
import { toSimplified } from './domain/chinese';
import { normalizeTranscript } from './domain/transcript';
import { transcribeInCloud } from './engines/cloud';

/** 云端转写的客户端上限。 */
export const CLOUD_TIMEOUT_MS = 20_000;

/** 云端没有给出可用文字。`message` 已经是给用户看的话。 */
export class VoiceTranscriptionError extends Error {
  readonly failures: AsrAttemptFailure[];

  constructor(failures: AsrAttemptFailure[]) {
    super(describeFailure(failures));
    this.name = 'VoiceTranscriptionError';
    this.failures = failures;
  }
}

/**
 * 把一段录音转成文字。
 *
 * @param uri 本地录音文件（`file://...`）
 * @param api 只需要 `transcribeAudio` 一个方法
 */
export async function transcribeRecording(
  uri: string,
  api: Pick<Endpoints, 'transcribeAudio'>,
): Promise<AsrResult> {
  const started = Date.now();
  try {
    const raw = await withTimeout(
      transcribeInCloud(api, uri),
      CLOUD_TIMEOUT_MS,
      '云端转写超时',
    );
    // 云端通常返回简体；偶尔仍会出繁体（尤其人名 / 地名），统一转一次
    const text = toSimplified(normalizeTranscript(raw.text ?? ''));
    if (!text) {
      throw new Error('没有识别到文字');
    }
    const elapsedMs = Date.now() - started;
    // 联调埋点：哪条通道、花了多久，是真机上最先要看的东西
    console.log(`[asr] 云端转写成功：${elapsedMs}ms，${text.length} 字`);
    return {
      text,
      language: raw.language ?? null,
      channel: 'cloud',
      elapsedMs,
    };
  } catch (cause) {
    const message = failureMessage(cause);
    console.log(`[asr] 云端转写失败：${message}（${String(cause)}）`);
    throw new VoiceTranscriptionError([{ channel: 'cloud', message }]);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}

/**
 * 把异常折成一句用户能看懂的话。
 *
 * <p>`ApiError.message` 是服务端给的业务话术，但 90002 / 网络错误要走
 * `userFacingMessage` 的统一映射，不把「未配置」这类实现细节露给用户。
 */
function failureMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    return userFacingMessage(cause.code, cause.message, '云端识别失败');
  }
  if (cause instanceof Error) {
    if (cause.message.includes('超时') || cause.message === '没有识别到文字') {
      return cause.message;
    }
    return '识别失败，请重试';
  }
  return '识别失败';
}
