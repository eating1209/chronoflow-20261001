import { useEffect } from 'react';
import { AppState } from 'react-native';

import { refreshLocalReminders } from '../modules/notifications';
import type { Endpoints } from '../api/endpoints';

/** 两次重排之间的最小间隔：冷启动与回前台都可能触发，没必要每次都打服务端。 */
const REMINDER_RESYNC_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 本机提醒的定期重排（spec §4.5）。
 *
 * <p>只排一次不够：重复日程只排得出最近的若干次、别的设备改了提醒、用户把通知开关关掉
 * ——这些都不会体现在本机的排期里。冷启动 + 回到前台各对齐一次，把差异收掉。
 *
 * <p>`force` 用于冷启动那次（无条件跑）；回前台走节流，避免用户频繁切 App 时反复请求。
 */
export function useReminderResync(options: {
  api: Endpoints;
  scheduler: Parameters<typeof refreshLocalReminders>[0]['scheduler'];
  enabled: boolean;
}) {
  const { api, scheduler, enabled } = options;

  useEffect(() => {
    let lastRun = 0;
    const run = (force: boolean) => {
      const now = Date.now();
      if (!force && now - lastRun < REMINDER_RESYNC_INTERVAL_MS) {
        return;
      }
      lastRun = now;
      void refreshLocalReminders({ api, scheduler, enabled });
    };
    run(true);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        run(false);
      }
    });
    return () => subscription.remove();
  }, [api, scheduler, enabled]);
}
