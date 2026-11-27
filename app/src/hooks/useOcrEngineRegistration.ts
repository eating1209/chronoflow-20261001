import { useEffect } from 'react';
import Constants from 'expo-constants';

import { registerBundledOcrEngine, warmUpOcrEngine } from '../modules/vision';

/**
 * 注册端侧 OCR 引擎（spec §4.1.9）。
 *
 * <p>「上传图片 → 识别日程」的第一段是手机本地的 OCR（图片不出手机），它是原生模块。
 * 这里只注册一个**代理**，实现要等第一次真的识别时才加载——启动路径上不碰原生模块，
 * 免得原生库有问题就让整个 App 打不开。**Expo Go 里拿不到模块**时，界面会如实说
 * 「端侧识别需要开发版构建」，而不是静默失败或偷偷改成上传图片到服务器。
 *
 * <p>自检开关（默认关，出包时打开）：`EXPO_PUBLIC_OCR_SELF_TEST=1`。
 * 打开后启动即把引擎（下载模型 + 建 ONNX session）跑一遍并打日志——
 * OCR 在「登录后的日历页」，而真机问题只在这条链路上出现，模拟器又没法登录，
 * 所以需要一个不依赖登录的复现入口。
 */
export function useOcrEngineRegistration() {
  useEffect(() => {
    registerBundledOcrEngine();

    const selfTestEnabled =
      process.env.EXPO_PUBLIC_OCR_SELF_TEST === '1' ||
      Constants.expoConfig?.extra?.ocrSelfTest === true;
    if (selfTestEnabled) {
      void warmUpOcrEngine().then(
        () => console.log('[vision] OCR 自检：引擎加载流程结束'),
        (cause) => console.log(`[vision] OCR 自检异常：${String(cause)}`),
      );
    }
  }, []);
}
