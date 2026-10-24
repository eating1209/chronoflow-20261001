/**
 * compliance 模块的纯逻辑公开出口。
 *
 * 给 App、identity、auth/consentStore 和 Node 单测使用：
 * 这些场景只需要同意判定和法律文档元信息，不应该把 React Native 页面带进来。
 */
export * from './domain/consent';
export * from './domain/legal';
