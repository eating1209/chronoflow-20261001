/**
 * 登录密码的**纯逻辑**：强度规则与登录页的可提交判定。
 *
 * <p>规则必须与后端 `PasswordPolicy` 一致（8-20 位、不含空白）。
 * 前端先拦一次是为了即时反馈；后端仍然会校验——客户端校验永远只是体验，不是安全边界。
 */

import { accountIssue } from '../../../shared/accountIdentifier';

export type LoginMode = 'sms' | 'password';

export const PASSWORD_RULE = '密码需 8-20 位，且不能包含空格';

export function passwordIssue(value: string): string | null {
  if (value.length < 8 || value.length > 20) {
    return PASSWORD_RULE;
  }
  if (/\s/.test(value)) {
    return PASSWORD_RULE;
  }
  return null;
}

export function passwordsMatch(first: string, second: string): boolean {
  return first.length > 0 && first === second;
}

/** 密码模式下「登录」按钮能不能点：手机号 11 位、密码非空、已勾选协议。 */
/**
 * 密码登录能否提交。
 *
 * <p>账号可以是手机号或邮箱，所以**不能用「长度是否为 11」判断**——
 * 那会让邮箱账号永远灰着按钮。改成「格式看起来完整」：
 * 合法手机号或合法邮箱都算填好了，具体对不对由服务端说了算。
 */
export function canSubmitPasswordLogin(input: {
  account: string;
  password: string;
  acceptedPolicy: boolean;
}): boolean {
  return (
    accountIssue(input.account) === null
    && input.password.length > 0
    && input.acceptedPolicy
  );
}
