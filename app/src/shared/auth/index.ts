/**
 * 共享认证基础设施：会话、令牌存储、组织账号登录记录与旧存储键迁移。
 *
 * 隐私同意记录的存储仍留在 `app/src/auth/consentStore.ts`：
 * 它依赖 compliance 模块的纯逻辑，属于应用装配层，不放进 shared。
 */
export * from './orgAccounts';
export * from './session';
export * from './storageMigration';
export * from './tokenStore';
