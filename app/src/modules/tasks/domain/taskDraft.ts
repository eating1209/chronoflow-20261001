import type { Priority } from '../../../shared/api';
import type { Task } from '../../../shared/api';
import {
  DEFAULT_EVENT_TIME,
  isValidDateKey,
  localDateKey,
  parseTime,
  toIso,
  type EditorSwitchSnapshot,
  type EventPlace,
  type ReminderSoundChoice,
} from '../../calendar/pure';

/**
 * 新建待办草稿。
 *
 * 待办与日程的关键差别：截止时间可以完全不存在（「待安排」清单）。
 * 因此这里用 hasDue 显式表达「没有截止时间」，而不是靠空串猜。
 */
export interface TaskDraft {
  title: string;
  description: string;
  /** 结构化地点：有些待办是「去某处交材料」，地点和截止时间一样重要 */
  place: EventPlace | null;
  /** 详细地址：地图只到楼，教室 / 门牌由用户手填 */
  locationDetail: string;
  /** 兼容历史数据：编辑页已不再展示手动优先级，新建时保持普通 */
  priority: Priority;
  hasDue: boolean;
  dueDate: string;
  dueTime: string;
  /** 兼容历史数据：编辑页已移除关联日程入口，已有数据仍原样保留 */
  eventId: number | null;
  eventTitle: string | null;
  /**
   * 重复规则（RRULE，spec §4.1.2）：待办也能重复，如「每周五交周报」。
   * 与日程一样存 RRULE 字符串本身，生成/解析都在 domain/recurrence.ts。
   */
  rrule: string;
  /** 本地提醒的提前量（分钟）；服务端也存一份（PUT /reminders），用于换设备后重排 */
  reminders: number[];
}

export function emptyTaskDraft(todayKey: string): TaskDraft {
  return {
    title: '',
    description: '',
    place: null,
    locationDetail: '',
    priority: 'NORMAL',
    hasDue: false,
    dueDate: todayKey,
    dueTime: '09:00',
    eventId: null,
    eventTitle: null,
    rrule: '',
    reminders: [],
  };
}

/** 新建页切到「日程」时，把待办草稿整理成两边都能理解的快照。 */
export function switchSnapshotFromTaskDraft(
  draft: TaskDraft,
  todayKey: string,
  reminderSound: ReminderSoundChoice,
): EditorSwitchSnapshot {
  return {
    title: draft.title,
    description: draft.description,
    priority: draft.priority,
    rrule: draft.rrule,
    reminders: draft.reminders,
    reminderSound,
    // 待办没设截止时间时切到日程：落在今天，时间用日程默认值
    dateKey: draft.hasDue ? draft.dueDate : todayKey,
    time: draft.hasDue ? draft.dueTime : DEFAULT_EVENT_TIME,
    hasDue: draft.hasDue,
    place: draft.place,
    locationDetail: draft.locationDetail,
    eventId: draft.eventId,
    eventTitle: draft.eventTitle,
  };
}

/** 从日程切到待办时恢复公共字段，并把原日程的发生时刻作为截止时刻。 */
export function taskDraftFromSwitch(snapshot: EditorSwitchSnapshot): TaskDraft {
  return {
    title: snapshot.title,
    description: snapshot.description,
    place: snapshot.place,
    locationDetail: snapshot.locationDetail,
    priority: snapshot.priority,
    hasDue: snapshot.hasDue,
    dueDate: snapshot.dateKey,
    dueTime: snapshot.time,
    eventId: snapshot.eventId,
    eventTitle: snapshot.eventTitle,
    rrule: snapshot.rrule,
    reminders: snapshot.reminders,
  };
}

export type TaskDraftValidation = { ok: true } | { ok: false; message: string };

export function validateTaskDraft(draft: TaskDraft): TaskDraftValidation {
  if (!draft.title.trim()) {
    return { ok: false, message: '请填写标题' };
  }
  if (!draft.hasDue) {
    return { ok: true };
  }
  if (!isValidDateKey(draft.dueDate)) {
    return { ok: false, message: '截止日期格式应为 YYYY-MM-DD' };
  }
  if (!parseTime(draft.dueTime)) {
    return { ok: false, message: '截止时间格式应为 HH:mm' };
  }
  return { ok: true };
}

export function buildCreateTaskPayload(draft: TaskDraft) {
  const description = draft.description.trim();
  const locationDetail = draft.locationDetail.trim();
  return {
    title: draft.title.trim(),
    description: description ? description : null,
    locationName: draft.place?.name ?? null,
    locationAddress: draft.place?.address ?? null,
    locationDetail: locationDetail ? locationDetail : null,
    latitude: draft.place?.latitude ?? null,
    longitude: draft.place?.longitude ?? null,
    poiId: draft.place?.poiId ?? null,
    // 无截止时间的待办归入「待安排」，dueAt 送 null
    dueAt: draft.hasDue ? toIso(draft.dueDate, draft.dueTime) : null,
    priority: draft.priority,
    eventId: draft.eventId,
    // 空串表示「不重复」：服务端把空白一律归一成 null，PATCH 里 null 才是「不修改」
    rrule: draft.rrule.trim(),
  };
}

const TASK_TIMEZONE = 'Asia/Shanghai';

/** 从已有待办还原草稿，供编辑页预填。 */
export function draftFromTask(task: Task, todayKey: string): TaskDraft {
  if (!task.dueAt) {
    return {
      title: task.title,
      description: task.description ?? '',
      place:
        task.locationName == null && task.latitude == null
          ? null
          : {
              poiId: task.poiId ?? null,
              name: task.locationName ?? '已选地点',
              address: task.locationAddress ?? null,
              latitude: task.latitude ?? null,
              longitude: task.longitude ?? null,
            },
      locationDetail: task.locationDetail ?? '',
      priority: task.priority ?? 'NORMAL',
      hasDue: false,
      dueDate: todayKey,
      dueTime: '09:00',
      // 后端开了 non_null 序列化：为空时字段会整个消失，拿到的是 undefined 而不是 null。
      // 必须在这里归一到 null，否则界面上「是否已关联」的判断会被 undefined 带偏。
      eventId: task.eventId ?? null,
      eventTitle: task.eventTitle ?? null,
      rrule: task.rrule ?? '',
      // 提醒由 PUT /reminders 单独维护，编辑页加载后另行拉取回填
      reminders: [],
    };
  }
  return {
    title: task.title,
    description: task.description ?? '',
    place:
      task.locationName == null && task.latitude == null
        ? null
        : {
            poiId: task.poiId ?? null,
            name: task.locationName ?? '已选地点',
            address: task.locationAddress ?? null,
            latitude: task.latitude ?? null,
            longitude: task.longitude ?? null,
          },
    locationDetail: task.locationDetail ?? '',
    priority: task.priority ?? 'NORMAL',
    hasDue: true,
    dueDate: localDateKey(task.dueAt, TASK_TIMEZONE),
    dueTime: timeInZone(task.dueAt),
    eventId: task.eventId ?? null,
    eventTitle: task.eventTitle ?? null,
    rrule: task.rrule ?? '',
    reminders: [],
  };
}

/** 编辑待办的请求体：清空截止时间要靠 clearDueAt 显式表达。 */
export function buildUpdateTaskPayload(draft: TaskDraft) {
  const base = buildCreateTaskPayload(draft);
  return {
    title: base.title,
    description: base.description,
    locationName: base.locationName ?? '',
    locationAddress: base.locationAddress ?? '',
    locationDetail: base.locationDetail ?? '',
    latitude: base.latitude,
    longitude: base.longitude,
    poiId: base.poiId ?? '',
    priority: base.priority,
    dueAt: base.dueAt,
    clearDueAt: !draft.hasDue,
    eventId: base.eventId,
    // 解绑必须显式表达：null 在 PATCH 里是「不修改」
    clearEvent: draft.eventId === null,
    rrule: base.rrule,
  };
}

function timeInZone(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TASK_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
