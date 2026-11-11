import { describe, expect, it } from 'vitest';

import type { EventDetail } from '../src/shared/api';
import {
  buildSystemCalendarEvent,
  systemCalendarBackfillRange,
} from '../src/modules/calendar/domain/systemCalendar';

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

  it('回填时间窗是往前 30 天、往后 365 天（固定 UTC+8）', () => {
    const range = systemCalendarBackfillRange(new Date('2026-11-09T10:00:00+08:00'));
    expect(range.start).toBe('2026-10-10T00:00:00+08:00');
    expect(range.end).toBe('2027-11-09T23:59:59+08:00');
  });
});
