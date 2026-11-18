import { describe, expect, it } from 'vitest';

import { isValidDateKey } from '../src/modules/calendar/pure';
import {
  buildCreateTaskPayload,
  buildUpdateTaskPayload,
  draftFromTask,
  emptyTaskDraft,
  taskDraftFromRecognized,
  validateTaskDraft,
} from '../src/modules/tasks/domain/taskDraft';
import type { Task } from '../src/shared/api';

const task: Task = {
  id: 7,
  calendarId: 1,
  parentTaskId: null,
  eventId: null,
  eventTitle: null,
  title: '交周报',
  description: null,
  dueAt: '2026-10-09T10:00:00Z',
  status: 'TODO',
  completedAt: null,
  priority: 'NORMAL',
  rrule: 'FREQ=WEEKLY;BYDAY=FR',
  sortOrder: 0,
};

/**
 * 待办的重复规则与提醒（spec §4.1.2）。
 *
 * 与日程同一套语义：**空串 = 不重复**（PATCH 里 null 是「不修改」），
 * 而提醒不走 task 行，编辑页要单独拉一次 `GET /reminders`。
 */
describe('待办的重复与提醒', () => {
  it('回填：服务端的 rrule 能还原到草稿，编辑一次不会把它抹掉', () => {
    const draft = draftFromTask(task, '2026-10-05');
    expect(draft.rrule).toBe('FREQ=WEEKLY;BYDAY=FR');
    // 提醒不在 task 行上，由编辑页另行拉取
    expect(draft.reminders).toEqual([]);
    expect(buildUpdateTaskPayload(draft).rrule).toBe('FREQ=WEEKLY;BYDAY=FR');
  });

  it('改回「不重复」提交的是空串（null 在 PATCH 里是「不修改」）', () => {
    const draft = { ...draftFromTask(task, '2026-10-05'), rrule: '' };
    expect(buildUpdateTaskPayload(draft).rrule).toBe('');
    expect(buildCreateTaskPayload({ ...draft, title: '交周报' }).rrule).toBe('');
  });

  it('没设过 rrule 的待办（字段缺失）按「不重复」处理', () => {
    const draft = draftFromTask({ ...task, rrule: undefined }, '2026-10-05');
    expect(draft.rrule).toBe('');
  });
});

describe('新建待办草稿', () => {
  it('识别结果铺成待办：有截止日期就回填，没有日期留在「待安排」', () => {
    const withDue = taskDraftFromRecognized({
      title: '交材料',
      at: '2026-09-24T00:00:00+08:00',
      timezone: 'Asia/Shanghai',
      locationName: '教务处',
    }, '2026-09-20');
    expect(withDue.hasDue).toBe(true);
    expect(withDue.dueDate).toBe('2026-09-24');
    expect(withDue.dueTime).toBe('09:00');
    expect(withDue.place?.name).toBe('教务处');
    expect(withDue.description).toContain('请核对');

    const withoutDue = taskDraftFromRecognized({ title: '整理资料' }, '2026-09-20');
    expect(withoutDue.hasDue).toBe(false);
    expect(withoutDue.title).toBe('整理资料');
  });

  it('地点、坐标与详细地址会进入请求体，也能从已有待办回填', () => {
    const draft = {
      ...emptyTaskDraft('2026-10-05'),
      title: '交材料',
      place: {
        poiId: 'poi-1',
        name: '行政楼',
        address: '海大路 1 号',
        latitude: 30.123,
        longitude: 122.456,
      },
      locationDetail: '305 办公室',
    };

    expect(buildCreateTaskPayload(draft)).toMatchObject({
      locationName: '行政楼',
      locationAddress: '海大路 1 号',
      locationDetail: '305 办公室',
      latitude: 30.123,
      longitude: 122.456,
      poiId: 'poi-1',
    });

    const restored = draftFromTask(
      {
        ...task,
        locationName: '行政楼',
        locationAddress: '海大路 1 号',
        locationDetail: '305 办公室',
        latitude: 30.123,
        longitude: 122.456,
        poiId: 'poi-1',
      },
      '2026-10-05',
    );
    expect(restored.place).toMatchObject({ name: '行政楼', latitude: 30.123 });
    expect(restored.locationDetail).toBe('305 办公室');
  });

  it('编辑时清除地点会提交空串，清空才不会在 PATCH 里变成“不修改”', () => {
    const draft = { ...emptyTaskDraft('2026-10-05'), title: '交材料' };
    expect(buildUpdateTaskPayload(draft)).toMatchObject({
      locationName: '',
      locationAddress: '',
      locationDetail: '',
      poiId: '',
      latitude: null,
      longitude: null,
    });
  });

  it('默认不设截止时间，归入「待安排」', () => {
    const draft = emptyTaskDraft('2026-10-05');
    expect(draft.hasDue).toBe(false);
    expect(validateTaskDraft({ ...draft, title: '买牛奶' })).toEqual({ ok: true });
    expect(buildCreateTaskPayload({ ...draft, title: '买牛奶' }).dueAt).toBeNull();
  });

  it('设了截止时间就拼成带时区的时刻', () => {
    const draft = {
      ...emptyTaskDraft('2026-10-05'),
      title: '交周报',
      hasDue: true,
      dueDate: '2026-10-09',
      dueTime: '18:00',
    };
    expect(buildCreateTaskPayload(draft).dueAt).toBe('2026-10-09T18:00:00+08:00');
  });

  it('时间拨到 00:00 就是「就这一天」', () => {
    const draft = {
      ...emptyTaskDraft('2026-10-05'),
      title: '盘点',
      hasDue: true,
      dueDate: '2026-10-09',
      dueTime: '00:00',
    };
    expect(buildCreateTaskPayload(draft).dueAt).toBe('2026-10-09T00:00:00+08:00');
  });

  it('标题为空要拦住', () => {
    expect(validateTaskDraft({ ...emptyTaskDraft('2026-10-05'), title: '   ' })).toEqual({
      ok: false,
      message: '请填写标题',
    });
  });

  it('截止日期必须是真实存在的一天', () => {
    const base = { ...emptyTaskDraft('2026-10-05'), title: '交周报', hasDue: true };
    expect(validateTaskDraft({ ...base, dueDate: '2026-02-30' })).toEqual({
      ok: false,
      message: '截止日期格式应为 YYYY-MM-DD',
    });
    expect(validateTaskDraft({ ...base, dueDate: '2026-10-09' }).ok).toBe(true);
  });

  it('截止时间格式非法要拦住', () => {
    const base = {
      ...emptyTaskDraft('2026-10-05'),
      title: '交周报',
      hasDue: true,
      dueDate: '2026-10-09',
    };
    expect(validateTaskDraft({ ...base, dueTime: '25:00' })).toEqual({
      ok: false,
      message: '截止时间格式应为 HH:mm',
    });
  });

  it('isValidDateKey 拒绝形状正确但不存在的日期', () => {
    expect(isValidDateKey('2026-10-05')).toBe(true);
    expect(isValidDateKey('2024-02-29')).toBe(true);
    expect(isValidDateKey('2026-02-29')).toBe(false);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('2026-1-1')).toBe(false);
    expect(isValidDateKey('')).toBe(false);
  });
});
