import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TEST_UPDATE_URL,
  TEST_UPDATE_URLS,
  normalizeTestUpdateUrl,
} from '../src/modules/notifications/domain/testUpdate';

describe('隐藏测试更新的地址规则', () => {
  it('接受 http / https 直链并去掉首尾空格', () => {
    expect(normalizeTestUpdateUrl('  https://chronocloud.top/downloads/chronoflow-test.apk  '))
      .toBe('https://chronocloud.top/downloads/chronoflow-test.apk');
    expect(normalizeTestUpdateUrl('http://192.168.1.5:8000/test.apk'))
      .toBe('http://192.168.1.5:8000/test.apk');
  });

  it('拒绝空串、相对路径和非 http 协议', () => {
    expect(normalizeTestUpdateUrl('')).toBeNull();
    expect(normalizeTestUpdateUrl('/downloads/chronoflow-test.apk')).toBeNull();
    expect(normalizeTestUpdateUrl('ftp://example.com/test.apk')).toBeNull();
    expect(normalizeTestUpdateUrl('https://example.com/a b.apk')).toBeNull();
  });

  it('默认地址指向固定的测试包文件名', () => {
    expect(DEFAULT_TEST_UPDATE_URL).toMatch(/\/downloads\/chronoflow-test\.apk$/);
    expect(DEFAULT_TEST_UPDATE_URL).toBe(TEST_UPDATE_URLS.direct);
  });
});
