/**
 * 轻量级全局提示总线。
 *
 * <p>保存成功后页面会立刻返回上一页，提示必须比编辑页活得更久，所以放在导航树外层渲染，
 * 由这里把消息送到 `ToastHost`。保持纯 TypeScript，方便单测；真正的视觉在 `toast.tsx`。
 */
export interface ToastMessage {
  id: number;
  message: string;
  durationMs: number;
}

type ToastListener = (toast: ToastMessage) => void;

const listeners = new Set<ToastListener>();
let nextId = 1;

/** 显示一条不需要用户确认的短提示。空消息直接忽略。 */
export function showToast(message: string, durationMs = 2200): void {
  const text = message.trim();
  if (!text) {
    return;
  }
  const toast: ToastMessage = {
    id: nextId++,
    message: text,
    durationMs: Math.max(800, durationMs),
  };
  for (const listener of listeners) {
    listener(toast);
  }
}

export function subscribeToast(listener: ToastListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
