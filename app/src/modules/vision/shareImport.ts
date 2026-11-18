import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';
import { File } from 'expo-file-system';

type NativeShareImport = {
  consumeImage(): Promise<{
    uri?: string;
    mimeType?: string;
    error?: string;
  } | null>;
};

export interface ConsumedShareImage {
  uri: string | null;
  mimeType: string | null;
  error: string | null;
}

const EVENT_READY = 'chronoflow.share.imageReady';

function nativeShareImport(): NativeShareImport | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  return (NativeModules as Record<string, unknown>).ChronoflowShareImport as
    | NativeShareImport
    | undefined ?? null;
}

/** 取走一张由系统分享进来的图片；没有待处理图片时返回空。 */
export async function consumeSharedImage(): Promise<ConsumedShareImage | null> {
  const module = nativeShareImport();
  if (!module?.consumeImage) {
    return null;
  }
  const payload = await module.consumeImage();
  if (!payload || (!payload.uri && !payload.error)) {
    return null;
  }
  return {
    uri: payload.uri ?? null,
    mimeType: payload.mimeType ?? null,
    error: payload.error ?? null,
  };
}

/** 识别结束后删掉缓存副本；原始文件属于分享方，不能动。 */
export function discardSharedImage(uri: string): void {
  if (Platform.OS !== 'android' || !uri.startsWith('file://')) {
    return;
  }
  try {
    new File(uri).delete();
  } catch {
    // 文件已被系统清理时忽略；下次分享还有 24 小时兜底清理。
  }
}

/** 分享图片复制完成时通知 JS；App 冷启动时由调用方再主动取一次。 */
export function subscribeSharedImages(listener: () => void): () => void {
  if (Platform.OS !== 'android' || !nativeShareImport()) {
    return () => undefined;
  }
  const subscription = DeviceEventEmitter.addListener(EVENT_READY, listener);
  return () => subscription.remove();
}
