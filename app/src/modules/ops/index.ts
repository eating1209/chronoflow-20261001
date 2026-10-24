/**
 * ops 模块的公开出口。
 *
 * 负责「我的」主页、分类子页、意见反馈，以及反馈/媒体/功能开关的纯逻辑。
 * 需要纯逻辑时优先 import `pure.ts`，避免把 RN 页面带进 Node 单测。
 */
export { SettingsScreen } from './screens/SettingsScreen';
export {
  SETTINGS_SECTION_TITLES,
  SettingsSectionScreen,
  type SettingsSectionKey,
} from './screens/SettingsSectionScreen';
export { FeedbackScreen } from './screens/FeedbackScreen';

export * from './pure';
