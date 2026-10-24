/**
 * compliance 模块的公开出口。
 *
 * 负责首启隐私政策同意页与合规文本 WebView 页，以及同意判定和
 * 法律文档入口的纯逻辑。
 *
 * 需要纯逻辑时优先 import `pure.ts`，避免把 RN 页面带进 Node 单测。
 */
export { LegalScreen } from './screens/LegalScreen';
export { PrivacyConsentScreen } from './screens/PrivacyConsentScreen';

export * from './pure';
