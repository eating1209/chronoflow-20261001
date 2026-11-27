import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import {
  DeviceRecognitionUnavailable,
  consumeSharedImage,
  discardSharedImage,
  recognizeScheduleImage,
  subscribeSharedImages,
  type RecognizedDraft,
} from '../modules/vision';
import type { Endpoints } from '../api/endpoints';

/**
 * 系统「分享图片」到本 App 时，自动识别成日程草稿并跳到确认页。
 *
 * <p>从 `App.tsx` 抽出来的：原来这几个 effect 与导航树、会话状态混在同一个
 * 1400 行组件里，改分享逻辑要在一堆无关代码里找。这里只依赖 `api`、`today`
 * 和一个「就绪后去哪」的回调。
 *
 * <p>三个容易踩的点（都是原有行为，原样保留）：
 * 1. **冷启动要主动取一次**——分享事件在 App 还没起来时就发生了，订阅晚了会漏；
 * 2. **回到前台再取一次**——用户从别的 App 分享回来时，事件可能已被系统丢掉；
 * 3. **导航树可能还没 ready**——首次启动直接 navigate 会静默失败，故最多等 3 秒重试。
 */
export function useSharedImageImport(options: {
  api: Endpoints;
  today: string;
  /** 导航容器当前是否可用（不可用时会重试） */
  isNavigationReady: () => boolean;
  /** 草稿识别好之后去哪（通常是 navigate 到确认页） */
  onDraftsReady: (drafts: RecognizedDraft[]) => void;
}) {
  const { api, today, isNavigationReady, onDraftsReady } = options;

  const [recognizing, setRecognizing] = useState(false);
  const [pendingDrafts, setPendingDrafts] = useState<RecognizedDraft[] | null>(null);
  /** 用 ref 而不是 state：判断的是「这一刻有没有在处理」，不该触发重渲染 */
  const busyRef = useRef(false);

  const importSharedImage = useCallback(
    async (uri: string) => {
      if (busyRef.current) {
        return;
      }
      busyRef.current = true;
      setRecognizing(true);
      try {
        const result = await recognizeScheduleImage({ uri, api, today });
        if (result.status === 'no-text') {
          Alert.alert('没识别出文字', '这张截图里没有识别出可用的文字，换一张再试。');
          return;
        }
        if (result.status === 'no-drafts') {
          Alert.alert('没找到要做的事', '这张截图里没有找到要做的事。');
          return;
        }
        setPendingDrafts(result.drafts);
      } catch (cause) {
        if (cause instanceof DeviceRecognitionUnavailable) {
          Alert.alert(
            '端侧识别还没就绪',
            `${cause.message}\n\n识别全程在手机本地完成，不会把图片上传到服务器。`,
          );
        } else {
          Alert.alert('截图识别失败', '这张图没有识别成功，请稍后重试。');
        }
      } finally {
        // 无论成功失败都要删掉原生侧的临时文件，否则分享目录会一直涨
        discardSharedImage(uri);
        busyRef.current = false;
        setRecognizing(false);
      }
    },
    [api, today],
  );

  const consumeSharedImageIfAny = useCallback(async () => {
    if (busyRef.current) {
      return;
    }
    try {
      const shared = await consumeSharedImage();
      if (!shared) {
        return;
      }
      if (shared.error) {
        Alert.alert('截图导入失败', shared.error);
        return;
      }
      if (shared.uri) {
        await importSharedImage(shared.uri);
      }
    } catch {
      Alert.alert('截图导入失败', '没有读到这张图片，请重新分享一次。');
    }
  }, [importSharedImage]);

  /** 冷启动主动取一次；运行中由原生事件 / 回前台再取。 */
  useEffect(() => {
    let cancelled = false;
    const consume = () => {
      if (!cancelled) {
        void consumeSharedImageIfAny();
      }
    };
    consume();
    const offShare = subscribeSharedImages(consume);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        consume();
      }
    });
    return () => {
      cancelled = true;
      offShare();
      subscription.remove();
    };
  }, [consumeSharedImageIfAny]);

  /** 识别出草稿后再跳确认页：首次启动时导航树可能还没 ready，最多等 3 秒。 */
  useEffect(() => {
    if (!pendingDrafts) {
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const open = () => {
      if (cancelled) {
        return;
      }
      if (isNavigationReady()) {
        onDraftsReady(pendingDrafts);
        setPendingDrafts(null);
        return;
      }
      // 20 × 150ms = 3 秒，与原来一致
      if (attempts < 20) {
        attempts += 1;
        timer = setTimeout(open, 150);
      }
    };
    open();
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [pendingDrafts, isNavigationReady, onDraftsReady]);

  return { recognizing };
}
