/**
 * 导航参数与页面间回调的类型定义。
 *
 * <p>从 `App.tsx` 抽出来的：这些类型被 Tab、Stack 与 20 个回调共用，
 * 混在 1200 行的组件文件顶部时，改一个参数要滚很远才找得到定义。
 *
 * <p>注意 `AppStackParamList` 里每个字段都有注释说明「什么时候会带这个参数」——
 * 这是导航树的实际契约，改之前先看清谁在用。
 */

import type { EventDraft } from '../modules/calendar/pure';
import type { Recurrence } from '../modules/calendar/pure';
import type { TaskDraft } from '../modules/tasks/domain/taskDraft';
import type { RecognizedDraft } from '../modules/vision';
import type { OrgEvent } from '../shared/api';
import type { ReminderSound } from '../shared/notifications';
import type { LegalDoc } from '../modules/compliance';
import type { SettingsSectionKey } from '../modules/ops';

export type MainTabsProps = {
  onCreateEvent: (dateKey: string) => void;
  onOpenEvent: (eventId: number, dateKey: string, occurrenceDate: string | null) => void;
  onCreateTask: () => void;
  onOpenTask: (taskId: number) => void;
  onOpenOrgAccounts: () => void;
  /** 图片识别出来一批日程草稿：进确认页让用户补日期 / 改标题，再一键添加（spec §4.1.9） */
  onReviewDrafts: (drafts: RecognizedDraft[]) => void;
  /** 语音输入：进「按住说话」页面（spec §4.1.9.1） */
  onVoiceInput: () => void;
  /** 组织管理员在手机上新建并下发组织日程（spec §4.2.2） */
  onCreateOrgEvent: (dateKey: string) => void;
  /** 编辑自己下发的组织日程（spec §4.2.2：只有发起人能改） */
  onEditOrgEvent: (event: OrgEvent) => void;
  onOpenOrgEvent: (identityId: number, dateKey: string) => void;
  /** 改名字（昵称，spec §4.1.8）：昵称可改，服务端是 PATCH /me */
  onOpenProfileEdit: () => void;
  /** 打开「我的」里某一类设置的独立子页 */
  onOpenSection: (section: SettingsSectionKey) => void;
  /** 选好头像原图后进取景页（正方框 + 拖动缩放，spec §4.1.8） */
  onOpenAvatarCrop: (uri: string) => void;
  /** 取景页裁完回传的本地图片（version 变了才处理） */
  avatarCrop: { version: number; uri: string | null };
  /** 日程保存后让日历定位到对应日期；version 变了才处理 */
  agendaFocus: { version: number; dateKey: string | null };
};

export type AppStackParamList = {
  /** 深链 / 通知点进来时可以指定先落到哪个 tab（任务总览图标 → 待办） */
  Main: { screen?: 'Agenda' | 'Tasks' | 'OrgEvents' | 'Settings' } | undefined;
  /** 语音输入：按住说话 → 转写 → 解析成日程（spec §4.1.9.1） */
  VoiceInput: undefined;
  EventEditor: {
    dateKey: string;
    eventId?: number;
    occurrenceDate?: string | null;
    /** 从「待办」切回来时预填的新建草稿 */
    initialDraft?: EventDraft;
    initialReminderSound?: ReminderSound;
  };
  /** 图片识别出的日程草稿 → 确认页（补日期 / 改标题 / 一键添加，spec §4.1.9） */
  EventImport: { drafts: RecognizedDraft[] };
  /** 确认页里点开的某一条草稿 → 整页编辑器（草稿模式，改完回传、不落库） */
  EventDraftEditor: { draft: EventDraft; dateKey: string };
  /** 确认页里点开的待办草稿 → 待办编辑器（草稿模式，改完回传、不落库） */
  TaskDraftEditor: { draft: TaskDraft };
  TaskEditor: {
    taskId?: number;
    /** 从「日程」切过来时预填的新建草稿 */
    initialDraft?: TaskDraft;
    initialReminderSound?: ReminderSound;
  };
  OrgEventEditor: { dateKey: string; event?: OrgEvent };
  OrgRecipientPicker: undefined;
  LocationPicker: undefined;
  RecurrencePicker: { startDateKey: string; initial: Recurrence };
  ReminderPicker: { initial: { minutes: number[]; sound: ReminderSound } };
  Feedback: undefined;
  OrgAccounts: undefined;
  /** 改名字（昵称）：二级页而不是弹窗，键盘与校验都在同一套页面结构里（spec §4.1.8） */
  ProfileEdit: undefined;
  SettingsSection: { section: SettingsSectionKey };
  RealName: undefined;
  EmailBind: undefined;
  PhoneChange: undefined;
  /** 「账号与安全」里设置 / 修改登录密码 */
  Password: undefined;
  /** 头像取景：正方框 + 拖动缩放，确认后按框裁成 1:1（spec §4.1.8） */
  AvatarCrop: { uri: string };
  Legal: { doc: LegalDoc };
  AccountDeletion: undefined;
};
