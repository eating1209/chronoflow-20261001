import { useEffect } from 'react';
import { AppState } from 'react-native';

import { askPermission } from '../shared/permission';
import {
  clearTaskBarNotification,
  flushPendingTaskBarCompletions,
  restoreTaskBarOverlay,
  subscribeNativeTaskBarCompletion,
  syncTaskBarNotification,
} from '../modules/tasks/system';
import type { Endpoints } from '../api/endpoints';

/** 刷新节流：冷启动与回前台都可能触发，没必要每次都打服务端。 */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 通知栏 / 锁屏常驻任务总览 + 锁屏勾选的补同步。
 *
 * <p>这两件事生命周期一致（都跟着 `taskBarEnabled` 与 `api` 走），所以放在同一个 hook 里。
 *
 * <p>**首次启动先用自己的文案说明用途，再申请系统通知权限**；用户拒绝就如实关掉开关，
 * 不反复弹窗。之后冷启动、回到前台都会同步内容。
 *
 * <p>两条容易踩的约束（都保留了原有处理）：
 * 1. **cleanup 里不能清通知**——App 被从最近任务划掉、Activity 销毁时也会走到 cleanup，
 *    清了就会出现「划掉后台，任务条变 0 项、通知卡消失」。真正的退出登录在
 *    `AppContext.signOut` 里清理，隐私不会留在锁屏上。
 * 2. **锁屏里勾掉的条目要补同步**——它们先记在原生本地队列，App 启动和回前台时补传，
 *    失败的留到下一次，不会出现「锁屏勾了、App 里还在」。
 */
export function useTaskBar(options: {
  api: Endpoints;
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}) {
  const { api, enabled, setEnabled } = options;

  // ---- 常驻任务总览 ----
  useEffect(() => {
    let cancelled = false;
    let lastRun = 0;

    if (!enabled) {
      void clearTaskBarNotification();
      return () => {
        cancelled = true;
      };
    }

    const refresh = async (requestPermission: boolean) => {
      if (cancelled) {
        return;
      }
      const granted = await askPermission(
        'notification',
        requestPermission ? {} : { quiet: true },
      );
      if (cancelled) {
        return;
      }
      if (!granted) {
        // 用户明确拒绝：如实关掉开关，不反复弹窗
        if (requestPermission) {
          setEnabled(false);
        }
        await clearTaskBarNotification();
        return;
      }
      await syncTaskBarNotification({ api, enabled: true });
      await restoreTaskBarOverlay();
    };

    lastRun = Date.now();
    void refresh(true);
    const subscription = AppState.addEventListener('change', (state) => {
      const now = Date.now();
      if (state === 'active' && now - lastRun >= REFRESH_INTERVAL_MS) {
        lastRun = now;
        void refresh(false);
      }
    });
    return () => {
      cancelled = true;
      subscription.remove();
      // 见函数注释第 1 条：这里**不能**清通知
    };
  }, [api, setEnabled, enabled]);

  // ---- 锁屏勾掉的条目补同步 ----
  useEffect(() => {
    let cancelled = false;
    const flush = () => {
      if (!cancelled) {
        void flushPendingTaskBarCompletions(api);
      }
    };
    flush();
    const offNative = subscribeNativeTaskBarCompletion(flush);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        flush();
      }
    });
    return () => {
      cancelled = true;
      offNative();
      subscription.remove();
    };
  }, [api]);
}
