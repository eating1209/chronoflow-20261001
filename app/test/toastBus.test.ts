import { showToast, subscribeToast } from '../src/shared/ui/toastBus';

describe('toastBus', () => {
  it('dispatches a trimmed message to every listener', () => {
    const first: string[] = [];
    const second: string[] = [];
    const offFirst = subscribeToast((toast) => first.push(toast.message));
    const offSecond = subscribeToast((toast) => second.push(toast.message));

    showToast('  日程已添加  ');

    expect(first).toEqual(['日程已添加']);
    expect(second).toEqual(['日程已添加']);
    offFirst();
    offSecond();
  });

  it('ignores blank messages and stops after unsubscribe', () => {
    const received: string[] = [];
    const off = subscribeToast((toast) => received.push(toast.message));

    showToast('   ');
    expect(received).toEqual([]);

    showToast('已保存');
    off();
    showToast('不会收到');

    expect(received).toEqual(['已保存']);
  });
});
