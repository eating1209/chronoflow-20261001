/**
 * 录音适配层。
 *
 * <p>优先使用 `withPcmRecorder` 注入的 16 kHz PCM 模块；如果当前安装包没有这个
 * 原生模块（例如从旧 APK 升级、或 Expo Go），自动退回 `expo-audio` 的 m4a 录音。
 * 云端 `qwen3-asr-flash` 两种格式都接受，所以不需要为了格式再卡住功能。
 *
 * <p>JS 侧只做三件事：判模块在不在、把路径补成 `file://`、用完删文件。
 * 所有「怎么录」都在原生模块 / expo-audio 里。
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

/** expo-audio 的录音实例；只在原生 PCM 模块不存在时使用。 */
type ExpoRecorder = {
  uri: string | null;
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
  release?: () => void;
};

let expoRecorder: ExpoRecorder | null = null;
let expoStartedAt = 0;

function nativeModule(): PcmRecorderNative | null {
  return (NativeModules.ChronoflowPcm as PcmRecorderNative | undefined) ?? null;
}

/** 录音模块是否就绪（Expo Go / Web / iOS 里没有）。 */
export function pcmRecorderAvailable(): boolean {
  if (nativeModule() !== null) {
    return true;
  }
  // expo-audio 是当前构建已有的依赖；只有 Web 预览没有录音实现。
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

/**
 * 录音不可用时对用户说的一句话。
 *
 * <p>iOS 这一轮不做（产品决定「Android 先跑通」），不能对 iPhone 用户说
 * 「请更新安装包」——那句话会让他们一直试。
 */
export function pcmRecorderUnavailableReason(): string {
  if (Platform.OS === 'web') {
    return '语音输入需要在手机上使用';
  }
  return '录音模块没就绪：请更新到最新安装包';
}

export async function startPcmRecording(): Promise<void> {
  const module = nativeModule();
  if (module) {
    await module.start(SAMPLE_RATE);
    return;
  }
  if (Platform.OS === 'web') {
    throw new Error('语音输入需要在手机上使用');
  }

  const { AudioModule } = await import('expo-audio');
  await AudioModule.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
  const recorder = new AudioModule.AudioRecorder({
    extension: '.m4a',
    sampleRate: SAMPLE_RATE,
    numberOfChannels: 1,
    bitRate: 32_000,
    android: {
      extension: '.m4a',
      outputFormat: 'mpeg4',
      audioEncoder: 'aac',
    },
    ios: {
      extension: '.m4a',
      outputFormat: 'aac',
      audioQuality: 32,
      linearPCMBitDepth: 16,
      linearPCMIsBigEndian: false,
      linearPCMIsFloat: false,
    },
    web: {
      mimeType: 'audio/webm',
      bitsPerSecond: 32_000,
    },
  }) as unknown as ExpoRecorder;
  await recorder.prepareToRecordAsync();
  recorder.record();
  expoRecorder = recorder;
  expoStartedAt = Date.now();
}

function toFileUri(path: string): string {
  return path.startsWith('file://') ? path : `file://${path}`;
}

export async function stopPcmRecording(): Promise<RecordingFile> {
  const module = nativeModule();
  if (module) {
    const result = await module.stop();
    return {
      uri: toFileUri(result.path),
      durationMs: result.durationMs,
      size: result.size,
    };
  }

  const recorder = expoRecorder;
  if (!recorder) {
    throw new Error('录音模块没就绪：需要开发版 / 正式版安装包');
  }
  await recorder.stop();
  const uri = recorder.uri ? toFileUri(recorder.uri) : '';
  if (!uri) {
    throw new Error('录音文件没有生成，请重试');
  }
  let size = 0;
  try {
    const { File } = await import('expo-file-system');
    size = new File(uri).size ?? 0;
  } catch {
    // 文件大小只用于日志 / 诊断，读不到不影响上传
  }
  const durationMs = Date.now() - expoStartedAt;
  expoRecorder = null;
  recorder.release?.();
  return { uri, durationMs, size };
}

/** 上滑取消 / 页面卸载：停掉并删掉临时文件。 */
export async function cancelPcmRecording(): Promise<void> {
  const module = nativeModule();
  if (module) {
    try {
      await module.cancel();
    } catch (cause) {
      console.log(`[asr] 取消录音失败：${String(cause)}`);
    }
    return;
  }

  const recorder = expoRecorder;
  expoRecorder = null;
  if (!recorder) {
    return;
  }
  try {
    await recorder.stop();
    if (recorder.uri) {
      await deleteRecording(toFileUri(recorder.uri));
    }
  } catch (cause) {
    console.log(`[asr] 取消录音失败：${String(cause)}`);
  } finally {
    recorder.release?.();
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
