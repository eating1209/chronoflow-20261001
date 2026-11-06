import { describe, expect, it } from 'vitest';

import {
  actionKindFor,
  actionsFor,
  categoryIdFor,
  COMPLETE_ACTION_ID,
  DEFAULT_ACTION_IDENTIFIER,
  SNOOZE_ACTION_ID,
  SNOOZE_MINUTES,
} from '../src/modules/notifications/reminderActions';

describe('提醒通知动作', () => {
  it('日程只能稍后，待办还能直接完成', () => {
    expect(actionsFor('EVENT').map((item) => item.identifier)).toEqual([SNOOZE_ACTION_ID]);
    expect(actionsFor('TASK').map((item) => item.identifier)).toEqual([
      SNOOZE_ACTION_ID,
      COMPLETE_ACTION_ID,
    ]);
    expect(actionsFor('TASK')[0]!.buttonTitle).toBe(`稍后 ${SNOOZE_MINUTES} 分钟`);
    // App 被系统杀死时按钮也必须能唤起监听
    expect(actionsFor('TASK').every((item) => item.options.opensAppToForeground)).toBe(true);
    expect(categoryIdFor('EVENT')).not.toBe(categoryIdFor('TASK'));
  });

  it('动作标识只在合法目标上生效', () => {
    expect(actionKindFor(DEFAULT_ACTION_IDENTIFIER, 'EVENT')).toBe('OPEN');
    expect(actionKindFor('', 'EVENT')).toBe('OPEN');
    expect(actionKindFor(SNOOZE_ACTION_ID, 'EVENT')).toBe('SNOOZE');
    expect(actionKindFor(SNOOZE_ACTION_ID, 'TASK')).toBe('SNOOZE');
    expect(actionKindFor(COMPLETE_ACTION_ID, 'TASK')).toBe('COMPLETE');
    expect(actionKindFor(COMPLETE_ACTION_ID, 'EVENT')).toBe('UNKNOWN');
    expect(actionKindFor('someone.else', 'TASK')).toBe('UNKNOWN');
  });
});
