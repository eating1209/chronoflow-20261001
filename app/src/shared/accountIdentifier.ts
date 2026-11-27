/**
 * 登录标识识别：手机号**还是**邮箱。
 *
 * <p>登录页只有一个输入框——用户不该先选「我要用邮箱登录」。这里只做**本地即时判断**，
 * 用于：
 * <ol>
 *   <li>切换键盘类型（手机号用 phone-pad，邮箱用 email 键盘）；</li>
 *   <li>决定输入框的提示文案与清空按钮的行为；</li>
 *   <li>提交前给出「请输入完整邮箱」这类即时提示，而不是等服务端 400。</li>
 * </ol>
 *
 * <p><b>最终判定权在服务端</b>（`AccountIdentifier.java`）：
 * 本地判断只为体验，两边规则必须一致——不一致会出现「前端放行、后端拒绝」的诡异状态。
 * 改这里时同步改后端，`accountIdentifier.test.ts` 盯着这条约束。
 */
export type AccountKind = 'PHONE' | 'EMAIL' | 'UNKNOWN';

const PHONE_PATTERN = /^1[3-9]\d{9}$/;
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** 判定顺序不能反：邮箱的本地部分也允许数字，先判 @ 更安全。 */
export function accountKind(raw: string): AccountKind {
  const value = raw.trim();
  if (!value) {
    return 'UNKNOWN';
  }
  if (value.includes('@')) {
    return EMAIL_PATTERN.test(value) ? 'EMAIL' : 'UNKNOWN';
  }
  return PHONE_PATTERN.test(value) ? 'PHONE' : 'UNKNOWN';
}

/** 输入框的键盘类型：邮箱需要能打 @ 和 .，手机号只要数字。 */
export function keyboardFor(kind: AccountKind): 'phone-pad' | 'email-address' {
  return kind === 'EMAIL' ? 'email-address' : 'phone-pad';
}

/**
 * 输入框的提示文案。随用户输入变化：
 * 空 / 认不出时给两种都行的提示，认出后就不再啰嗦。
 */
export function accountPlaceholder(raw: string): string {
  const kind = accountKind(raw);
  if (kind === 'EMAIL') {
    return '请输入邮箱';
  }
  if (kind === 'PHONE') {
    return '请输入手机号';
  }
  return '手机号 / 邮箱';
}

/**
 * 提交前的格式校验。**只判「看起来完整」，不判「账号是否存在」**——
 * 后者是服务端的职责，客户端猜不出来，猜错只会误导用户。
 */
export function accountIssue(raw: string): string | null {
  const value = raw.trim();
  if (!value) {
    return '请输入手机号或邮箱';
  }
  if (value.includes('@')) {
    return EMAIL_PATTERN.test(value) ? null : '邮箱格式不正确，请检查是否漏了 @ 或域名';
  }
  if (PHONE_PATTERN.test(value)) {
    return null;
  }
  return '请输入 11 位手机号，或完整的邮箱地址';
}
