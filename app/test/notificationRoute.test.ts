import { describe, expect, it } from 'vitest';

import {
  routeFromNotificationData,
  routeFromResponse,
  tapFromResponse,
} from '../src/modules/notifications/route';
import { SNOOZE_ACTION_ID } from '../src/modules/notifications/reminderActions';

/**
 * 通知点击的路由解析（spec §4.5）。
 *
 * 这是 App 启动路径上的代码：解析不出来必须安静地返回 null，而不是抛异常
 * —— 一条旧版本排下的通知不该让新版本打不开。
 */
describe('通知点击路由', () => {
  it('日程通知 → 打开那条日程的编辑页（带上「哪一次」）', () => {
    expect(
      routeFromNotificationData({
        targetType: 'EVENT',
        targetId: 12,
        occurrenceDate: '2026-10-07',
        minutesBefore: 15,
      }),
    ).toEqual({ kind: 'EVENT', eventId: 12, occurrenceDate: '2026-10-07' });
  });

  it('待办通知 → 打开那条待办（待办没有「哪一次」的概念）', () => {
    expect(routeFromNotificationData({ targetType: 'TASK', targetId: 7 })).toEqual({
      kind: 'TASK',
      taskId: 7,
    });
  });

  it('非重复日程的 occurrenceDate 是 null（排期时就写的是 null）', () => {
    expect(routeFromNotificationData({ targetType: 'EVENT', targetId: 3, occurrenceDate: null }))
      .toEqual({ kind: 'EVENT', eventId: 3, occurrenceDate: null });
  });

  it('认不出的数据一律忽略，不抛异常', () => {
    expect(routeFromNotificationData(null)).toBeNull();
    expect(routeFromNotificationData(undefined)).toBeNull();
    expect(routeFromNotificationData('EVENT:12')).toBeNull();
    expect(routeFromNotificationData({ targetType: 'EVENT' })).toBeNull();
    expect(routeFromNotificationData({ targetType: 'EVENT', targetId: 0 })).toBeNull();
    expect(routeFromNotificationData({ targetType: 'EVENT', targetId: 'abc' })).toBeNull();
    expect(routeFromNotificationData({ targetType: 'ORG_EVENT', targetId: 9 })).toBeNull();
  });

  it('从原生回执里取到 data（冷启动与运行中走的是同一个解析）', () => {
    expect(
      routeFromResponse({
        notification: { request: { content: { data: { targetType: 'TASK', targetId: 5 } } } },
      }),
    ).toEqual({ kind: 'TASK', taskId: 5 });
    expect(routeFromResponse(null)).toBeNull();
  });

  it('动作按钮的回执同时带回原文，稍后提醒才能按原样重排', () => {
    expect(
      tapFromResponse({
        actionIdentifier: SNOOZE_ACTION_ID,
        notification: {
          request: {
            identifier: 'local-123',
            content: {
              title: '周会',
              body: '9 月 28 日 10:00 · 会议室 A',
              data: { targetType: 'EVENT', targetId: 12, sound: 'alarm', occurrenceDate: '2026-09-28' },
            },
          },
        },
      }),
    ).toEqual({
      route: { kind: 'EVENT', eventId: 12, occurrenceDate: '2026-09-28' },
      actionIdentifier: SNOOZE_ACTION_ID,
      notificationId: 'local-123',
      title: '周会',
      body: '9 月 28 日 10:00 · 会议室 A',
      sound: 'alarm',
      data: { targetType: 'EVENT', targetId: 12, sound: 'alarm', occurrenceDate: '2026-09-28' },
    });
    expect(tapFromResponse(null)).toBeNull();
  });
});
