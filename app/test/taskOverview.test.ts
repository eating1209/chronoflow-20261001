import { describe, expect, it } from 'vitest';

import type { EventOccurrence, Task } from '../src/shared/api';
import {
  eventOverviewEntry,
  formatTaskDue,
  groupTaskOverviewByMonth,
  groupTasksByUrgency,
  groupTaskOverviewByUrgency,
  isOverdueAt,
  overviewEntryHasDetails,
  taskDateSectionLabel,
  taskOverviewEntry,
  taskUrgency,
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

describe('任务条紧急度', () => {
  it('未来 48 小时内为红，48 小时到一周为橙，一周后为绿', () => {
    expect(taskUrgency({ dueAt: '2026-10-05T00:00:00Z' }, NOW)).toBe('calm');
    expect(taskUrgency({ dueAt: '2026-10-05T15:59:00Z' }, NOW)).toBe('urgent');
    expect(taskUrgency({ dueAt: '2026-10-07T00:00:00Z' }, NOW)).toBe('urgent');
    expect(taskUrgency({ dueAt: '2026-10-07T01:00:00.001Z' }, NOW)).toBe('soon');
    expect(taskUrgency({ dueAt: '2026-10-12T01:00:00Z' }, NOW)).toBe('soon');
    expect(taskUrgency({ dueAt: '2026-10-12T01:00:00.001Z' }, NOW)).toBe('calm');
    expect(taskUrgency({ dueAt: null }, NOW)).toBe('calm');
    expect(taskUrgency({ dueAt: '2026-10-05T01:00:00Z' }, NOW)).toBe('urgent');
    expect(isOverdueAt('2026-10-05T00:00:00Z', NOW)).toBe(true);
    expect(isOverdueAt('2026-10-05T15:59:00Z', NOW)).toBe(false);
  });

  it('分组只收未完成任务，并保持传入顺序', () => {
    const groups = groupTasksByUrgency(
      [
        task({ id: 1, dueAt: '2026-10-05T02:00:00Z' }),
        task({ id: 2, dueAt: '2026-10-05T03:00:00Z' }),
        task({ id: 3, dueAt: '2026-10-07T02:00:00Z' }),
        task({ id: 4, dueAt: null }),
        task({ id: 5, dueAt: '2026-10-05T02:00:00Z', status: 'DONE' }),
        task({ id: 6, dueAt: '2026-10-04T02:00:00Z' }),
      ],
      NOW,
    );

    expect(groups.urgent.map((item) => item.id)).toEqual([1, 2]);
    expect(groups.soon.map((item) => item.id)).toEqual([3]);
    expect(groups.calm.map((item) => item.id)).toEqual([4]);
    expect([...groups.urgent, ...groups.soon, ...groups.calm].map((item) => item.id)).not.toContain(6);
  });

  it('日程与待办进入同一条时间轴，按发生时间排序', () => {
    const event: EventOccurrence = {
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
    const groups = groupTaskOverviewByUrgency(
      [
        taskOverviewEntry(task({ id: 1, dueAt: '2026-10-05T04:00:00Z' })),
        eventOverviewEntry(event),
        taskOverviewEntry(task({ id: 2, dueAt: '2026-10-08T04:00:00Z' })),
      ],
      NOW,
    );

    expect(groups.urgent.map((entry) => entry.key)).toEqual(['event:30:2026-10-05T03:00:00Z', 'task:1']);
    expect(groups.soon.map((entry) => entry.key)).toEqual(['task:2']);
  });

  it('逾期安排不进入紧急分组，但仍能从原条目单独识别', () => {
    const overdue = taskOverviewEntry(
      task({ id: 9, dueAt: '2026-10-04T02:00:00Z' }),
    );
    expect(isOverdueAt(overdue.at, NOW)).toBe(true);
    const groups = groupTaskOverviewByUrgency([overdue], NOW);
    expect(groups.urgent).toEqual([]);
    expect(groups.soon).toEqual([]);
    expect(groups.calm).toEqual([]);
  });

  it('截止时间按项目时区显示今天、明天和具体日期', () => {
    expect(formatTaskDue('2026-10-05T10:00:00Z', NOW)).toBe('今天 18:00');
    expect(formatTaskDue('2026-10-06T10:00:00Z', NOW)).toBe('明天 18:00');
    expect(formatTaskDue('2026-10-09T10:00:00Z', NOW)).toBe('10月9日 18:00');
    expect(formatTaskDue(null, NOW)).toBe('待安排');
  });

  it('只有展开后才有内容的条目也保留箭头', () => {
    const linked = taskOverviewEntry(task({ id: 1, eventId: 99, eventTitle: null }));
    expect(overviewEntryHasDetails(linked)).toBe(true);

    const plain = taskOverviewEntry(task({ id: 2 }));
    expect(overviewEntryHasDetails(plain)).toBe(false);

    const event: EventOccurrence = {
      eventId: 30,
      calendarId: 1,
      title: '线上评审',
      description: '提前十分钟进会议室',
      locationName: null,
      locationAddress: null,
      locationDetail: null,
      at: '2026-10-05T03:00:00Z',
      timezone: 'Asia/Shanghai',
      recurring: false,
      occurrenceDate: null,
      modified: false,
      done: false,
    };
    expect(overviewEntryHasDetails(eventOverviewEntry(event))).toBe(true);
    expect(overviewEntryHasDetails(eventOverviewEntry({ ...event, description: '  ' }))).toBe(false);
  });

  it('未来安排按月份、日期和时刻排好，逾期与待安排单独取出', () => {
    const event: EventOccurrence = {
      eventId: 30,
      calendarId: 1,
      title: '产品评审会',
      locationName: null,
      locationAddress: null,
      locationDetail: null,
      at: '2026-10-05T02:00:00Z',
      timezone: 'Asia/Shanghai',
      recurring: false,
      occurrenceDate: null,
      modified: false,
      done: false,
    };
    const layout = groupTaskOverviewByMonth(
      [
        taskOverviewEntry(
          task({ id: 1, title: '逾期待办', dueAt: '2026-10-04T10:00:00Z' }),
        ),
        taskOverviewEntry(
          task({ id: 2, title: '今天下午', dueAt: '2026-10-05T10:00:00Z' }),
        ),
        eventOverviewEntry(event),
        taskOverviewEntry(
          task({ id: 3, title: '明天中午', dueAt: '2026-10-06T04:00:00Z' }),
        ),
        taskOverviewEntry(
          task({ id: 4, title: '下个月', dueAt: '2026-11-01T10:00:00Z' }),
        ),
        taskOverviewEntry(task({ id: 5, title: '普通待安排', dueAt: null })),
        taskOverviewEntry(task({ id: 6, title: '重要待安排', dueAt: null, priority: 'HIGH' })),
        taskOverviewEntry(task({ id: 7, title: '坏时间', dueAt: 'not-a-date' })),
      ],
      NOW,
      'Asia/Shanghai',
    );

    expect(layout.overdue.map((entry) => entry.key)).toEqual(['task:1']);
    expect(layout.months.map((month) => month.monthKey)).toEqual(['2026-10', '2026-11']);
    expect(layout.months[0]?.dates.map((date) => date.dateKey)).toEqual([
      '2026-10-05',
      '2026-10-06',
    ]);
    expect(layout.months[0]?.dates[0]?.entries.map((entry) => entry.key)).toEqual([
      'event:30:2026-10-05T02:00:00Z',
      'task:2',
    ]);
    expect(layout.unscheduled.map((entry) => entry.key)).toEqual([
      'task:6',
      'task:7',
      'task:5',
    ]);
  });

  it('日期栏用今天、明天和具体日期加周几', () => {
    expect(taskDateSectionLabel('2026-10-05', '2026-10-05')).toEqual({
      primary: '今天',
      secondary: '10/5',
      isToday: true,
    });
    expect(taskDateSectionLabel('2026-10-06', '2026-10-05')).toEqual({
      primary: '明天',
      secondary: '10/6',
      isToday: false,
    });
    expect(taskDateSectionLabel('2026-11-03', '2026-10-05')).toEqual({
      primary: '11月3日',
      secondary: '周二',
      isToday: false,
    });
  });
});
