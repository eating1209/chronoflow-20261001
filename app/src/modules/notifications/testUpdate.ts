import { downloadAndInstallApk } from './apkInstaller';
import { normalizeTestUpdateUrl } from './domain/testUpdate';

const TEST_UPDATE_URL_KEY = 'chronoflow.test-update-url';

async function secureStore() {
  return import('expo-secure-store');
}

/** 读取用户保存过的测试包地址；没配置过返回 null，由界面填默认地址。 */
export async function readTestUpdateUrl(): Promise<string | null> {
  try {
    const Store = await secureStore();
    return (await Store.getItemAsync(TEST_UPDATE_URL_KEY))?.trim() || null;
  } catch {
    return null;
  }
}

export async function saveTestUpdateUrl(url: string): Promise<void> {
  const normalized = normalizeTestUpdateUrl(url);
  if (!normalized) {
    throw new Error('安装包地址要以 http:// 或 https:// 开头');
  }
  const Store = await secureStore();
  await Store.setItemAsync(TEST_UPDATE_URL_KEY, normalized);
}

export async function clearTestUpdateUrl(): Promise<void> {
  try {
    const Store = await secureStore();
    await Store.deleteItemAsync(TEST_UPDATE_URL_KEY);
  } catch {
    // 清不掉下次仍会显示旧地址；不影响正式更新
  }
}

/** 下载测试包并交给系统安装器；不比较版本号，地址里是什么就装什么。 */
export async function installTestUpdate(
  url: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const normalized = normalizeTestUpdateUrl(url);
  if (!normalized) {
    throw new Error('安装包地址要以 http:// 或 https:// 开头');
  }
  await downloadAndInstallApk(normalized, {
    fileName: 'chronoflow-test.apk',
    onProgress,
    signal,
  });
}
