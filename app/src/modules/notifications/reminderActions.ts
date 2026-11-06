import type { ReminderTargetType } from './reminderStore';

/** 系统通知分类：日程与待办能做的动作不同，所以分开注册。 */
export const REMINDER_CATEGORY_ID: Record<ReminderTargetType, string> = {
  EVENT: 'chronoflow.reminder.event',
  TASK: 'chronoflow.reminder.task',
};

/** 点「稍后 10 分钟」后重新排期的间隔。 */
export const SNOOZE_MINUTES = 10;

export const SNOOZE_ACTION_ID = 'chronoflow.reminder.snooze-10';
export const COMPLETE_ACTION_ID = 'chronoflow.reminder.complete';

/** 点通知本体（而不是动作按钮）时，系统回传的固定标识。 */
export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';

/** 只依赖结构类型，避免纯逻辑层为了一个按钮定义去加载原生模块。 */
export interface ReminderActionDefinition {
  identifier: string;
  buttonTitle: string;
  options: {
    /** 必须在 App 被杀死时也能唤起 JS 监听，否则按钮看起来可点、实际没反应。 */
    opensAppToForeground: boolean;
  };
}

export function categoryIdFor(targetType: ReminderTargetType): string {
  return REMINDER_CATEGORY_ID[targetType];
}

/**
 * 日程没有「完成」语义（只有待办有），所以只给「稍后」。
 * 待办完成会写服务端，因此多给一个「完成」。
 */
export function actionsFor(targetType: ReminderTargetType): ReminderActionDefinition[] {
  const snooze: ReminderActionDefinition = {
    identifier: SNOOZE_ACTION_ID,
    buttonTitle: `稍后 ${SNOOZE_MINUTES} 分钟`,
    options: { opensAppToForeground: true },
  };
  if (targetType === 'EVENT') {
    return [snooze];
  }
  return [
    snooze,
    {
      identifier: COMPLETE_ACTION_ID,
      buttonTitle: '完成',
      options: { opensAppToForeground: true },
    },
  ];
}

export type NotificationActionKind = 'OPEN' | 'SNOOZE' | 'COMPLETE' | 'UNKNOWN';

export function actionKindFor(actionIdentifier: string, targetType: ReminderTargetType): NotificationActionKind {
  if (actionIdentifier === SNOOZE_ACTION_ID) {
    return 'SNOOZE';
  }
  if (actionIdentifier === COMPLETE_ACTION_ID) {
    // 旧版本或手工构造的日程通知即使带了完成按钮，也不能猜一个不存在的「完成日程」接口
    return targetType === 'TASK' ? 'COMPLETE' : 'UNKNOWN';
  }
  if (!actionIdentifier || actionIdentifier === DEFAULT_ACTION_IDENTIFIER) {
    return 'OPEN';
  }
  return 'UNKNOWN';
}
