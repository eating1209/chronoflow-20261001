import type { EventPlace } from './eventDraft';
import type { EditorSwitchSnapshot, ReminderSoundChoice } from './editorTypes';

export type { EditorSwitchSnapshot, ReminderSoundChoice };
import type { Recurrence } from './recurrence';

/**
 * 提醒声音档位。
 *
 * 这里刻意用结构化类型而不是 import notifications 的 `ReminderSound`：
 * 提醒排期属于 notifications 模块，而 notifications 的排期又要用到日历的纯函数。
 * 纯层反向依赖 notifications 会形成「calendar/pure → notifications → calendar/pure」的环。
 */

/**
 * 新建页从「日程」切到「待办」（或反向）时的公共快照。
 *
 * 两个编辑页各自维护草稿，切换类型会 replace 到另一个整页；这份快照只带
 * 两边都有的概念，避免把某一侧的私有字段硬塞进另一侧。日期与时间在切换时
 * 按「日程发生时刻 / 待办截止时刻」互相映射，标题、备注、重复、提醒原样保留。
 */

/**
 * 二级页回传给编辑页的参数。
 *
 * 一律带 `version`：像「不设地点」「不重复」「不提醒」这类结果，值本身和「没改过」
 * 长得一模一样（都是 null / 空数组），只比较值就分不出「用户又选了一次」，
 * 界面会停在旧状态。version 只在用户按下「完成 / 确定」时 +1。
 */

/** 地点选择的回传：用 version 区分「重新选了同一个地点」与「选了不设地点」。 */
export interface PlaceSelection {
  version: number;
  place: EventPlace | null;
}

export interface RecurrenceSelection {
  version: number;
  recurrence: Recurrence | null;
}

export interface ReminderSelection {
  version: number;
  minutes: number[];
  /** 提醒方式（静音 / 消息提醒 / 闹钟）——按整条日程走，与提前量一起回传 */
  sound: ReminderSoundChoice;
}

/** 关联日程选择器回传的轻量结果。 */
export interface PickedEvent {
  eventId: number;
  title: string;
}
