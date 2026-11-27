import { useEffect } from 'react';
import { Linking } from 'react-native';

/**
 * 深链（自定义 scheme）路由。
 *
 * <p>任务总览通知卡左上角的图标带的是 `chronoflow://tasks`，点它才打开 App
 * 并直接落到「待办」；卡片其它区域不绑打开动作。这里只消费这一种 URL。
 *
 * <p>导航树在冷启动时可能还没 ready，直接 navigate 会静默失败，
 * 所以最多重试 3 秒（20 × 150ms）——与分享图片、通知点击用的是同一套等待策略。
 */
export function useDeepLinkRouting(options: { isNavigationReady: () => boolean; openTasks: () => void }) {
  const { isNavigationReady, openTasks } = options;

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const handle = (url: string | null) => {
      if (cancelled || !url || !url.startsWith('chronoflow://tasks')) {
        return;
      }
      let attempts = 0;
      const tryNavigate = () => {
        if (cancelled) {
          return;
        }
        if (isNavigationReady()) {
          openTasks();
          return;
        }
        if (attempts < 20) {
          attempts += 1;
          timer = setTimeout(tryNavigate, 150);
        }
      };
      tryNavigate();
    };

    void Linking.getInitialURL().then(handle).catch(() => undefined);
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
      subscription.remove();
    };
    // openTasks 由调用方用 ref 稳定住，避免每次渲染重订阅
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
