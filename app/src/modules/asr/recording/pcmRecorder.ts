/**
 * 录音：16 kHz / 单声道 / 16-bit PCM 的 WAV。
 *
 * <p>**为什么不用 `expo-audio`**：它的预设只能录 m4a/aac，而离线引擎（Whisper）
 * 要的是 PCM；云端虽然能直接吃 m4a，但两条通道用同一个 WAV 文件更简单，
 * 也少一次格式转换。原生模块由 `app/plugins/withPcmRecorder.js` 注入
 * （与 `withSystemLocation` 同一套 prebuild 做法），源码在插件里，不在 `android/` 下。
 *
 * <p>JS 侧只做三件事：判模块在不在、把路径补成 `file://`、用完删文件。
 * 所有「怎么录」都在原生模块里。
 */

import { NativeModules, Platform } from 'react-native';

export interface RecordingFile {
  /** `file://...`，可直接交给接口上传或本机引擎 */
  uri: string;
  durationMs: number;
  size: number;
}

interface PcmRecorderNative {
  start(sampleRate: number): Promise<boolean>;
  stop(): Promise<{ path: string; durationMs: number; size: number }>;
  cancel(): Promise<void>;
}

/** 16 kHz 是语音识别的事实标准；再高不会更准，只会更大。 */
const SAMPLE_RATE = 16_000;

function nativeModule(): PcmRecorderNative | null {
  return (NativeModules.ChronoflowPcm as PcmRecorderNative | undefined) ?? null;
}

/** 录音模块是否就绪（Expo Go / Web / iOS 里没有）。 */
export function pcmRecorderAvailable(): boolean {
  return Platform.OS === 'android' && nativeModule() !== null;
}

/**
 * 录音不可用时对用户说的一句话。
 *
 * <p>iOS 这一轮不做（产品决定「Android 先跑通」），不能对 iPhone 用户说
 * 「请更新安装包」——那句话会让他们一直试。
 */
export function pcmRecorderUnavailableReason(): string {
  if (Platform.OS !== 'android') {
    return '语音输入当前仅支持 Android，iOS 版本稍后提供';
  }
  return '录音模块没就绪：请更新到最新安装包';
}

export async function startPcmRecording(): Promise<void> {
  const module = nativeModule();
  if (!module) {
    throw new Error('录音模块没就绪：需要开发版 / 正式版安装包');
  }
  await module.start(SAMPLE_RATE);
}

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

export async function stopPcmRecording(): Promise<RecordingFile> {
  const module = nativeModule();
  if (!module) {
    throw new Error('录音模块没就绪：需要开发版 / 正式版安装包');
  }
  const result = await module.stop();
  return {
    uri: toFileUri(result.path),
    durationMs: result.durationMs,
    size: result.size,
  };
}

/** 上滑取消 / 页面卸载：停掉并删掉临时文件。 */
export async function cancelPcmRecording(): Promise<void> {
  const module = nativeModule();
  if (!module) {
    return;
  }
  try {
    await module.cancel();
  } catch (cause) {
    console.log(`[asr] 取消录音失败：${String(cause)}`);
  }
}

/**
 * 删除临时录音。
 *
 * <p>隐私边界：录音只用于这一次转写，**转完立即删**。失败只记日志——
 * 删不掉一个缓存文件不应该变成用户看到的错误。
 */
export async function deleteRecording(uri: string): Promise<void> {
  try {
    const { File } = await import('expo-file-system');
    new File(uri).delete();
  } catch (cause) {
    console.log(`[asr] 删除临时录音失败：${String(cause)}`);
  }
}
