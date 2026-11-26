import { File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

/**
 * 下载一个 APK 并交给系统安装器。
 *
 * <p>应用内更新和隐藏的「测试更新」共用这一段：两者只是安装包来源不同，
 * 下载、大小对账、content:// 授权和调起安装器的规则必须一致。
 */
export interface ApkInstallOptions {
  /** 缓存目录里的文件名；不要带路径分隔符 */
  fileName: string;
  /** 已知大小时做一次对账，挡住被截断 / 被网关替换的下载 */
  expectedSizeBytes?: number;
  onProgress?: (fraction: number) => void;
  /** 用户取消下载时中止请求 */
  signal?: AbortSignal;
}

export async function downloadAndInstallApk(
  url: string,
  options: ApkInstallOptions,
): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('当前环境不支持应用内更新，请到应用商店或官网下载新版。');
  }
  const targetUrl = url.trim();
  if (!/^https?:\/\//i.test(targetUrl)) {
    throw new Error('安装包地址要以 http:// 或 https:// 开头');
  }

  const target = new File(Paths.cache, options.fileName);
  if (target.exists) {
    // 上一次下了一半 / 下完没装：删掉重下，否则会报「目标已存在」
    target.delete();
  }
  const task = File.createDownloadTask(targetUrl, target, {
    signal: options.signal,
    onProgress: ({ bytesWritten, totalBytes }) => {
      // totalBytes 为 -1 表示服务端没给 Content-Length：这时不显示假的进度
      if (totalBytes > 0) {
        options.onProgress?.(bytesWritten / totalBytes);
      }
    },
  });
  const file = await task.downloadAsync();
  if (!file) {
    // 文档里的 null 只出现在「任务被暂停」时；我们没实现暂停，真出现就当失败
    throw new Error('安装包没有下载完成，请重试');
  }

  const expected = options.expectedSizeBytes ?? 0;
  if (expected > 0 && typeof file.size === 'number' && Math.abs(file.size - expected) > 1024) {
    throw new Error(`安装包大小对不上（应为 ${expected} 字节，实际 ${file.size} 字节）`);
  }

  // Android 7+ 必须把这个文件包成 content:// 才能交给系统安装器
  const contentUri = await getContentUriAsync(file.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: 'application/vnd.android.package-archive',
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION：临时把读权限授给安装器
  });
}
