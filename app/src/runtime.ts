import Constants from 'expo-constants';

import { createApiClient } from './shared/api';
import { createEndpoints, type Endpoints } from './api/endpoints';
import { withTimeout } from './shared/async';
import { SessionManager } from './shared/auth';
import {
  createMemoryTokenStore,
  createSecureTokenStore,
  loadOrCreateDeviceId,
  type TokenStore,
} from './shared/auth';
import { createExpoNotificationGateway } from './modules/notifications/expoGateway';
import { createSecureReminderIdStore } from './modules/notifications/reminderStore';
import { localNotificationsAvailable } from './shared/notifications/availability';
import {
  createNoopReminderScheduler,
  createReminderScheduler,
  type ReminderScheduler,
} from './modules/notifications/scheduler';

export function resolveBaseUrl(): string {
  const extra = Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined;
  return extra?.apiBaseUrl ?? 'http://localhost:8080';
}

export interface AppRuntime {
  session: SessionManager;
  api: Endpoints;
  /** 本机提醒排期（spec §4.5：到点提醒走本地通知，不经过服务端推送） */
  reminders: ReminderScheduler;
  deviceId: string;
  baseUrl: string;
}

const DEVICE_ID_TIMEOUT_MS = 3_000;
const TOKEN_STORE_TIMEOUT_MS = 3_000;
const REMINDER_TIMEOUT_MS = 4_000;

function transientDeviceId(): string {
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 设备 ID 读不出来时先让 App 能启动；最坏结果是这次登录被当成一台新设备。 */
async function loadDeviceIdSafe(): Promise<string> {
  try {
    return await withTimeout(
      loadOrCreateDeviceId(),
      DEVICE_ID_TIMEOUT_MS,
      '读取设备标识超时',
    );
  } catch (error) {
    console.warn('[startup] 安全存储读取设备标识失败，使用临时标识', error);
    return transientDeviceId();
  }
}

/**
 * 令牌存储的启动兜底。
 *
 * 原生安全存储偶发损坏、升级后密钥失效或在部分 ROM 上卡住时，不能让登录页也进不去。
 * 读失败就使用本次运行的内存会话；写失败仍保留在内存里，用户可以正常登录和操作。
 * 唯一的代价是这类用户下次启动需要重新登录。
 */
async function createRuntimeTokenStore(): Promise<TokenStore> {
  const fallback = createMemoryTokenStore();
  let secure: TokenStore;
  try {
    secure = await withTimeout(
      createSecureTokenStore(),
      TOKEN_STORE_TIMEOUT_MS,
      '初始化安全存储超时',
    );
  } catch (error) {
    console.warn('[startup] 安全存储不可用，本次会话改用内存存储', error);
    return fallback;
  }

  return {
    async read() {
      try {
        const stored = await withTimeout(
          secure.read(),
          TOKEN_STORE_TIMEOUT_MS,
          '读取登录状态超时',
        );
        if (stored) {
          await fallback.write(stored);
        } else {
          await fallback.clear();
        }
        return stored;
      } catch (error) {
        console.warn('[startup] 读取登录状态失败，改用内存会话', error);
        return fallback.read();
      }
    },
    async write(session) {
      await fallback.write(session);
      try {
        await withTimeout(
          secure.write(session),
          TOKEN_STORE_TIMEOUT_MS,
          '保存登录状态超时',
        );
      } catch (error) {
        console.warn('[startup] 保存登录状态失败，本次运行仍保留会话', error);
      }
    },
    async clear() {
      await fallback.clear();
      try {
        await withTimeout(secure.clear(), TOKEN_STORE_TIMEOUT_MS, '清除登录状态超时');
      } catch (error) {
        console.warn('[startup] 清除安全存储失败', error);
      }
    },
  };
}

/**
 * 组装本地提醒排期。
 *
 * 通知模块缺失（Web 预览、缺原生模块的构建）时降级成空实现而不是让 App 起不来：
 * 提醒排不了只是少一个功能，打不开 App 是事故。
 */
async function createReminderSchedulerSafe(): Promise<ReminderScheduler> {
  if (!localNotificationsAvailable()) {
    return createNoopReminderScheduler();
  }
  try {
    const gateway = await withTimeout(
      createExpoNotificationGateway(),
      REMINDER_TIMEOUT_MS,
      '初始化通知失败',
    );
    const store = await withTimeout(
      createSecureReminderIdStore(),
      REMINDER_TIMEOUT_MS,
      '初始化提醒存储超时',
    );
    return createReminderScheduler({ gateway, store });
  } catch (error) {
    console.warn('[startup] 提醒初始化失败，本次运行不排提醒', error);
    return createNoopReminderScheduler();
  }
}

/**
 * 组装运行时依赖。
 *
 * 刷新令牌的请求本身必须走**不带会话**的裸客户端，否则刷新失败时又会触发
 * 「刷新后重放」形成递归。
 */
export async function createRuntime(onSessionExpired: () => void): Promise<AppRuntime> {
  const baseUrl = resolveBaseUrl();
  const [deviceId, store] = await Promise.all([
    loadDeviceIdSafe(),
    createRuntimeTokenStore(),
  ]);

  const bareClient = createApiClient({ baseUrl });
  const bareEndpoints = createEndpoints(bareClient);

  const session = new SessionManager({
    store,
    refresh: (refreshToken) => bareEndpoints.refresh(refreshToken, deviceId),
  });

  const client = createApiClient({ baseUrl, session, onSessionExpired });
  return {
    session,
    api: createEndpoints(client),
    reminders: await createReminderSchedulerSafe(),
    deviceId,
    baseUrl,
  };
}
