import { describe, expect, it } from 'vitest';

import type { EventOccurrence, Task } from '../src/shared/api';
import { buildTaskBarPayload } from '../src/modules/tasks/domain/taskBar';
import {
  eventOverviewEntry,
  taskOverviewEntry,
} from '../src/modules/tasks/domain/taskOverview';

const NOW = Date.parse('2026-10-05T01:00:00Z');

function task(overrides: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    calendarId: 1,
    parentTaskId: null,
    eventId: null,
    eventTitle: null,
    title: `任务 ${overrides.id}`,
    description: null,
    dueAt: null,
    status: 'TODO',
    completedAt: null,
    priority: 'NORMAL',
    sortOrder: 0,
    ...overrides,
  };
}

const EVENT: EventOccurrence = {
  eventId: 30,
  calendarId: 1,
  title: '去政务中心交材料',
  locationName: '市政务服务中心',
  locationAddress: null,
  locationDetail: null,
  at: '2026-10-05T03:00:00Z',
  timezone: 'Asia/Shanghai',
  recurring: false,
  occurrenceDate: null,
  modified: false,
  done: false,
};

describe('任务栏通知文案', () => {
  it('合并日程与待办，给出今天截止、最近项和三组首条', () => {
    const payload = buildTaskBarPayload(
      [
        taskOverviewEntry(
          task({ id: 1, title: '提交备案材料', dueAt: '2026-10-05T10:00:00Z' }),
        ),
        eventOverviewEntry(EVENT),
        taskOverviewEntry(
          task({ id: 2, title: '确认审核账号可用', dueAt: '2026-10-07T10:00:00Z' }),
        ),
        taskOverviewEntry(task({ id: 3, title: '整理下周材料', dueAt: null })),
      ],
      NOW,
    );

    expect(payload.total).toBe(4);
    expect(payload.todayCount).toBe(2);
    expect(payload.headline).toBe('2 项任务今天截止');
    expect(payload.nearestTitle).toBe('去政务中心交材料');
    expect(payload.nearestWhen).toBe('今天 11:00');
    expect(payload.groups.map((group) => [group.key, group.count])).toEqual([
      ['urgent', 2],
      ['soon', 1],
      ['calm', 1],
    ]);
    expect(payload.groups[0]?.firstTitle).toBe('去政务中心交材料');
    expect(payload.groups[2]?.firstTitle).toBe('整理下周材料');
    expect(payload.groups[2]?.firstWhen).toBe('待安排');
  });

  it('全部完成或没有任务时返回可清空通知的结果', () => {
    const payload = buildTaskBarPayload([], NOW);
    expect(payload.total).toBe(0);
    expect(payload.headline).toBe('今天没有待办安排');
    expect(payload.groups.every((group) => group.count === 0)).toBe(true);
  });

  it('已过期安排不进入三色任务条，未来最近项仍正常显示', () => {
    const payload = buildTaskBarPayload(
      [
        taskOverviewEntry(
          task({ id: 1, title: '昨天没交的材料', dueAt: '2026-10-03T10:00:00Z' }),
        ),
        taskOverviewEntry(
          task({ id: 2, title: '明天要交的材料', dueAt: '2026-10-06T10:00:00Z' }),
        ),
      ],
      NOW,
    );

    expect(payload.total).toBe(1);
    expect(payload.overdueCount).toBe(0);
    expect(payload.groups.flatMap((group) => group.items).map((item) => item.id)).not.toContain(1);
    expect(payload.nearestTitle).toBe('明天要交的材料');
  });
});
