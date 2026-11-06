import { describe, expect, it } from 'vitest';

import {
  emptyDraft,
  eventDraftFromSwitch,
  switchSnapshotFromEventDraft,
} from '../src/modules/calendar/pure';
import {
  emptyTaskDraft,
  switchSnapshotFromTaskDraft,
  taskDraftFromSwitch,
} from '../src/modules/tasks/domain/taskDraft';

describe('新建安排的日程 / 待办切换', () => {
  it('日程切到待办：标题、备注、重复、提醒保留，发生时刻变成截止时刻', () => {
    const snapshot = switchSnapshotFromEventDraft(
      {
        ...emptyDraft(),
        title: '产品评审会',
        time: '20:00',
        description: '带电脑',
        priority: 'HIGH',
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        reminders: [10, 30],
      },
      '2026-11-02',
      'alarm',
    );

    const task = taskDraftFromSwitch(snapshot);

    expect(task).toMatchObject({
      title: '产品评审会',
      description: '带电脑',
      priority: 'HIGH',
      hasDue: true,
      dueDate: '2026-11-02',
      dueTime: '20:00',
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
      reminders: [10, 30],
    });
  });

  it('待办没有截止时间时切到日程：落在今天，时间回到默认 09:00', () => {
    const snapshot = switchSnapshotFromTaskDraft(
      {
        ...emptyTaskDraft('2026-11-02'),
        title: '补备案材料',
        description: '先问学长',
        priority: 'URGENT',
        reminders: [5],
      },
      '2026-11-02',
      'silent',
    );

    expect(snapshot.hasDue).toBe(false);
    expect(snapshot.dateKey).toBe('2026-11-02');
    expect(snapshot.time).toBe('09:00');

    const event = eventDraftFromSwitch(snapshot);
    expect(event).toMatchObject({
      title: '补备案材料',
      description: '先问学长',
      priority: 'URGENT',
      time: '09:00',
      place: null,
      reminders: [5],
    });
  });

  it('待办有截止时间时切到日程：截止日期和时刻原样变成日程时间', () => {
    const snapshot = switchSnapshotFromTaskDraft(
      {
        ...emptyTaskDraft('2026-11-02'),
        title: '提交材料',
        hasDue: true,
        dueDate: '2026-11-03',
        dueTime: '18:00',
      },
      '2026-11-02',
      'default',
    );

    expect(snapshot.dateKey).toBe('2026-11-03');
    expect(snapshot.time).toBe('18:00');
    expect(snapshot.hasDue).toBe(true);
    expect(eventDraftFromSwitch(snapshot)).toMatchObject({
      title: '提交材料',
      time: '18:00',
    });
  });

  it('地点、详细地址在日程和待办之间往返切换时不会丢', () => {
    const place = {
      poiId: 'poi-9',
      name: '图书馆',
      address: '学海路 8 号',
      latitude: 30.2,
      longitude: 122.1,
    };
    const snapshot = switchSnapshotFromEventDraft(
      {
        ...emptyDraft(),
        title: '交作业',
        place,
        locationDetail: '二楼服务台',
      },
      '2026-11-02',
      'default',
    );

    const task = taskDraftFromSwitch(snapshot);
    expect(task.place).toEqual(place);
    expect(task.locationDetail).toBe('二楼服务台');

    const back = eventDraftFromSwitch(switchSnapshotFromTaskDraft(task, '2026-11-02', 'default'));
    expect(back.place).toEqual(place);
    expect(back.locationDetail).toBe('二楼服务台');
  });
});
