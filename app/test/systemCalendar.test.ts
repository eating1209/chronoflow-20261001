import { describe, expect, it } from 'vitest';

import type { EventDetail, Task } from '../src/shared/api';
import {
  buildSystemCalendarEvent,
  buildSystemCalendarTask,
  isSystemCalendarTaskInBackfillRange,
  systemCalendarBackfillRange,
} from '../src/modules/calendar/domain/systemCalendar';

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 7,
    calendarId: 1,
    parentTaskId: null,
    eventId: null,
    eventTitle: null,
    title: '交实验报告',
    description: '打印后交到 302',
    locationName: '实验楼',
    locationAddress: '××路 2 号',
    locationDetail: '302',
    dueAt: '2026-11-12T18:00:00+08:00',
    status: 'TODO',
    completedAt: null,
    priority: 'NORMAL',
    rrule: null,
    sortOrder: 0,
    ...overrides,
  };
}

function detail(overrides: Partial<EventDetail> = {}): EventDetail {
  return {
    id: 42,
    calendarId: 1,
    title: '项目例会',
    description: '带上周报',
    locationName: '教学楼 A',
    locationAddress: '××路 1 号',
    locationDetail: '302 教室',
    latitude: null,
    longitude: null,
    poiId: null,
    coordinateSystem: null,
    at: '2026-11-09T10:00:00+08:00',
    durationMinutes: 90,
    timezone: 'Asia/Shanghai',
    rrule: null,
    status: 'CONFIRMED',
    availability: 'BUSY',
    color: null,
    priority: 'NORMAL',
    category: null,
    url: null,
    travelTimeMinutes: null,
    ...overrides,
  };
}

describe('系统日历单向导出的数据转换', () => {
  it('把日程详情转成原生模块要的字段，结束时间 = 开始 + 时长', () => {
    const payload = buildSystemCalendarEvent(detail());
    expect(payload.eventId).toBe(42);
    expect(payload.title).toBe('项目例会');
    expect(payload.startMillis).toBe(Date.parse('2026-11-09T10:00:00+08:00'));
    expect(payload.endMillis - payload.startMillis).toBe(90 * 60_000);
    expect(payload.allDay).toBe(false);
    expect(payload.locationName).toBe('教学楼 A');
    expect(payload.locationDetail).toBe('302 教室');
    expect(payload.rrule).toBe('');
  });

  it('没有时长时按 60 分钟导出，坏时间直接拒绝', () => {
    expect(
      buildSystemCalendarEvent(detail({ durationMinutes: null })).endMillis,
    ).toBe(Date.parse('2026-11-09T10:00:00+08:00') + 60 * 60_000);
    expect(() => buildSystemCalendarEvent(detail({ at: 'not-a-date' }))).toThrow();
  });

  it('重复规则原样带过去，交给系统日历按整条系列保存', () => {
    const payload = buildSystemCalendarEvent(
      detail({ rrule: 'FREQ=WEEKLY;BYDAY=MO', durationMinutes: 30 }),
    );
    expect(payload.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(payload.endMillis - payload.startMillis).toBe(30 * 60_000);
  });

  it('有截止时间的未完成待办按截止日整天导出，不再占满一年', () => {
    const payload = buildSystemCalendarTask(task());
    expect(payload?.eventId).toBe(-7);
    expect(payload?.title).toBe('交实验报告');
    expect(payload?.allDay).toBe(true);
    expect(payload?.startMillis).toBe(Date.UTC(2026, 10, 12));
    expect(payload!.endMillis - payload!.startMillis).toBe(24 * 60 * 60_000);
    expect(payload?.description).toContain('来自时纪流 · 待办（截止 2026-11-12 18:00）');
    expect(payload?.locationDetail).toBe('302');
  });

  it('没有截止时间的未完成待办从今天开始整天导出，并持续显示', () => {
    const now = new Date('2026-11-18T09:30:00+08:00');
    const payload = buildSystemCalendarTask(
      task({ dueAt: null, rrule: 'FREQ=DAILY' }),
      now,
    );
    expect(payload?.eventId).toBe(-7);
    expect(payload?.allDay).toBe(true);
    expect(payload?.startMillis).toBe(Date.UTC(2026, 10, 18));
    expect(payload!.endMillis - payload!.startMillis).toBe(365 * 24 * 60 * 60_000);
    expect(payload?.rrule).toBe('');
    expect(payload?.description).toContain('未设置截止时间，从今天起持续显示');
  });

  it('已完成、已取消和坏日期的待办不导出', () => {
    expect(buildSystemCalendarTask(task({ status: 'DONE' }))).toBeNull();
    expect(buildSystemCalendarTask(task({ status: 'CANCELLED' }))).toBeNull();
    expect(buildSystemCalendarTask(task({ dueAt: 'not-a-date' }))).toBeNull();
  });

  it('回填时包含未安排待办，只排除窗口外的有日期待办和已完成待办', () => {
    const rangeStart = Date.parse('2026-10-10T00:00:00+08:00');
    const rangeEnd = Date.parse('2027-11-09T23:59:59+08:00');
    expect(isSystemCalendarTaskInBackfillRange(task(), rangeStart, rangeEnd)).toBe(true);
    expect(
      isSystemCalendarTaskInBackfillRange(task({ dueAt: null }), rangeStart, rangeEnd),
    ).toBe(true);
    expect(
      isSystemCalendarTaskInBackfillRange(
        task({ dueAt: '2028-01-01T09:00:00+08:00' }),
        rangeStart,
        rangeEnd,
      ),
    ).toBe(false);
    expect(
      isSystemCalendarTaskInBackfillRange(
        task({ dueAt: null, status: 'DONE' }),
        rangeStart,
        rangeEnd,
      ),
    ).toBe(false);
  });

  it('回填时间窗是往前 30 天、往后 365 天（固定 UTC+8）', () => {
    const range = systemCalendarBackfillRange(new Date('2026-11-09T10:00:00+08:00'));
    expect(range.start).toBe('2026-10-10T00:00:00+08:00');
    expect(range.end).toBe('2027-11-09T23:59:59+08:00');
  });
});
