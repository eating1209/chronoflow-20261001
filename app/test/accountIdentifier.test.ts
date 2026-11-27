import { describe, expect, it } from 'vitest';

import {
  accountIssue,
  accountKind,
  accountPlaceholder,
  keyboardFor,
} from '../src/shared/accountIdentifier';

/**
 * 账号识别规则的护栏。
 *
 * <p>这些用例与后端 `AccountIdentifierTest.java` **一一对应**：
 * 前后端识别规则必须一致，否则会出现「前端放行、后端拒绝」的诡异状态
 * （用户按提示填对了，还是登不上）。改规则时两边一起改，用例一起补。
 */
describe('账号识别（手机号 / 邮箱）', () => {
  it('11 位以 1 开头的是手机号', () => {
    expect(accountKind('13900001234')).toBe('PHONE');
    expect(accountKind('18006569106')).toBe('PHONE');
    // 前后空格要被忽略（用户复制粘贴时常带空格）
    expect(accountKind('  13900001234  ')).toBe('PHONE');
  });

  it('含 @ 且格式完整的是邮箱', () => {
    expect(accountKind('a@b.com')).toBe('EMAIL');
    expect(accountKind('zhang.san+work@company.com.cn')).toBe('EMAIL');
  });

  it('邮箱的本地部分允许是纯数字（所以不能先按手机号判）', () => {
    expect(accountKind('13900001234@qq.com')).toBe('EMAIL');
  });

  it('格式不对时是 UNKNOWN', () => {
    expect(accountKind('')).toBe('UNKNOWN');
    expect(accountKind('   ')).toBe('UNKNOWN');
    expect(accountKind('1390000123')).toBe('UNKNOWN');    // 10 位
    expect(accountKind('23900001234')).toBe('UNKNOWN');   // 不是 1 开头
    expect(accountKind('a@b')).toBe('UNKNOWN');           // 缺顶级域
    expect(accountKind('@b.com')).toBe('UNKNOWN');        // 缺本地部分
    expect(accountKind('随便写点什么')).toBe('UNKNOWN');
  });

  it('键盘类型跟着账号类型走', () => {
    expect(keyboardFor('EMAIL')).toBe('email-address');
    expect(keyboardFor('PHONE')).toBe('phone-pad');
    // 认不出时给数字键盘：多数用户是手机号，邮箱用户可以自己切
    expect(keyboardFor('UNKNOWN')).toBe('phone-pad');
  });

  it('提示文案随输入变化，不啰嗦', () => {
    expect(accountPlaceholder('')).toBe('手机号 / 邮箱');
    expect(accountPlaceholder('139')).toBe('手机号 / 邮箱');
    expect(accountPlaceholder('13900001234')).toBe('请输入手机号');
    expect(accountPlaceholder('a@b.com')).toBe('请输入邮箱');
  });

  it('提交前校验：只说「格式完不完整」，不猜账号是否存在', () => {
    expect(accountIssue('13900001234')).toBeNull();
    expect(accountIssue('a@b.com')).toBeNull();
    expect(accountIssue('')).toBe('请输入手机号或邮箱');
    expect(accountIssue('1390000123')).toContain('11 位手机号');
    expect(accountIssue('a@b')).toContain('邮箱格式不正确');
  });
});
