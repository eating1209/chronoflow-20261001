import { afterEach, describe, expect, it, vi } from 'vitest';

import { OperationTimeoutError, withTimeout } from '../src/shared/async';

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('结果按时返回时透传原值', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000)).resolves.toBe('ok');
  });

  it('底层 Promise 不结束时按超时失败，避免启动页永久卡住', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<string>(() => undefined), 50, '启动超时');
    const assertion = expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<OperationTimeoutError>>({ message: '启动超时' }),
    );

    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
});
