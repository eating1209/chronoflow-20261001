package com.chronoflow.auth.service;

import com.chronoflow.common.api.ErrorCode;
import com.chronoflow.common.exception.BizException;

/**
 * 账号密码的强度规则：**只在这一处定义**，登录之外的「设置密码」和「忘记密码重置」都走它。
 *
 * <p>为什么要有：短信注册的账号本来没有密码，用户第一次设密码时最容易设成 8 位纯数字
 * （比如自己的生日）。密码一旦可登录，它就是账号的另一把钥匙，规则太松等于把账号交出去。
 */
public final class PasswordPolicy {

    public static final String MESSAGE = "密码需 8-20 位，且不能包含空格";

    private PasswordPolicy() {
    }

    public static void validate(String password) {
        if (password == null) {
            throw BizException.of(ErrorCode.PARAM_INVALID, MESSAGE);
        }
        boolean lengthOk = password.length() >= 8 && password.length() <= 20;
        boolean hasWhitespace = false;
        for (int i = 0; i < password.length(); i++) {
            if (Character.isWhitespace(password.charAt(i))) {
                hasWhitespace = true;
                break;
            }
        }
        if (!lengthOk || hasWhitespace) {
            throw BizException.of(ErrorCode.PARAM_INVALID, MESSAGE);
        }
    }
}
