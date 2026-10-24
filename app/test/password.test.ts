import { canSubmitPasswordLogin, passwordIssue, passwordsMatch } from '../src/modules/identity/domain/password';

describe('passwordIssue', () => {
  it('接受 8-20 位密码（不限制字符种类）', () => {
    expect(passwordIssue('chrono2026')).toBeNull();
    expect(passwordIssue('12345678')).toBeNull();
    expect(passwordIssue('abcdefgh')).toBeNull();
  });

  it('拒绝过短和过长的密码', () => {
    expect(passwordIssue('a1b2c3')).not.toBeNull();
    expect(passwordIssue('a'.repeat(21))).not.toBeNull();
  });

  it('拒绝包含空格的密码（前后端规则一致）', () => {
    expect(passwordIssue('chrono 2026')).not.toBeNull();
  });

  it('20 位是上限，21 位被拒绝', () => {
    expect(passwordIssue('a1'.repeat(10))).toBeNull();
    expect(passwordIssue('a1'.repeat(10) + 'x')).not.toBeNull();
  });
});

describe('passwordsMatch', () => {
  it('两次输入一致才算通过，空串不算', () => {
    expect(passwordsMatch('chrono2026', 'chrono2026')).toBe(true);
    expect(passwordsMatch('chrono2026', 'chrono2027')).toBe(false);
    expect(passwordsMatch('', '')).toBe(false);
  });
});

describe('canSubmitPasswordLogin', () => {
  const ok = { phone: '13800000000', password: 'chrono2026', acceptedPolicy: true };

  it('手机号、密码、协议都满足才可提交', () => {
    expect(canSubmitPasswordLogin(ok)).toBe(true);
    expect(canSubmitPasswordLogin({ ...ok, phone: '1380000' })).toBe(false);
    expect(canSubmitPasswordLogin({ ...ok, password: '' })).toBe(false);
    expect(canSubmitPasswordLogin({ ...ok, acceptedPolicy: false })).toBe(false);
  });
});
