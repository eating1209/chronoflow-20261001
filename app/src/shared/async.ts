/** 给启动链路用的超时保护：原生存储异常时 Promise 可能一直不结束。 */
export class OperationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationTimeoutError';
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message = '操作超时',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new OperationTimeoutError(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (cause) => {
        clearTimeout(timer);
        reject(cause);
      },
    );
  });
}
