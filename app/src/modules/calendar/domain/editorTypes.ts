/**
 * 编辑器里跨文件共用的纯类型。
 *
 * 单独一个文件是为了**打断循环依赖**：
 * `eventDraft` 需要 `EditorSwitchSnapshot` / `ReminderSoundChoice`，
 * 而 `editorSelection` 需要 `eventDraft` 的 `EventPlace`。
 * 两边都只依赖本文件，环形就断开了。
 *
 * `EventPlace` 也放在这里：它原本在 eventDraft.ts，但 eventDraft 又要
 * EditorSwitchSnapshot，两个文件互相 import 一样成环，所以一起搬过来。
 */

import type { Priority } from '../../../shared/api';

export type ReminderSoundChoice = 'silent' | 'default' | 'alarm';

export interface EditorSwitchSnapshot {
  title: string;
  description: string;
  priority: Priority;
  rrule: string;
  reminders: number[];
  reminderSound: ReminderSoundChoice;
  dateKey: string;
  time: string;
  /** 日程结束时间；切到待办时只使用开始时间作为截止时间，切回来时保留。 */
  endTime?: string;
  hasDue: boolean;
  place: EventPlace | null;
  locationDetail: string;
  eventId: number | null;
  eventTitle: string | null;
}

export interface EventPlace {
  poiId: string | null;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}
