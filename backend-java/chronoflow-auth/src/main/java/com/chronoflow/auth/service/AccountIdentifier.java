package com.chronoflow.auth.service;

import com.chronoflow.common.exception.BizException;
import com.chronoflow.common.api.ErrorCode;

import java.util.regex.Pattern;

/**
 * 登录标识：手机号**或**邮箱，二选一。
 *
 * <p>为什么不在 DTO 里拆成 `phone` / `email` 两个字段：调用方（App）只有**一个输入框**，
 * 用户不会先选「我要用邮箱登录」。拆两个字段等于把「判断这是什么」推给客户端，
 * 而客户端判断错了就是一次无谓的失败请求。这里由服务端统一识别，客户端只传一个字符串。
 *
 * <p>识别规则（顺序不能反）：
 * <ol>
 *   <li>含 {@code @} → 邮箱（本地部分也允许数字，所以不能先试手机号）；</li>
 *   <li>纯 11 位且以 1 开头 → 手机号；</li>
 *   <li>其它 → 直接报「格式不正确」，不要落到「账号不存在」——
 *       后者会让用户以为是自己记错了账号，实际上是格式问题。</li>
 * </ol>
 */
public record AccountIdentifier(Type type, String value) {

    public enum Type { PHONE, EMAIL }

    private static final Pattern PHONE = Pattern.compile("^1[3-9]\\d{9}$");
    private static final Pattern EMAIL = Pattern.compile("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
    /** 邮箱统一小写存查：Foo@Bar.com 与 foo@bar.com 是同一个账号 */
    private static final int PHONE_LENGTH = 11;

    /**
     * 解析用户输入。**失败一律抛 10002（参数错误）**，不区分「格式像手机号但不对」
     * 与「根本不是联系方」——都是输入问题。
     */
    public static AccountIdentifier parse(String raw) {
        String value = raw == null ? "" : raw.trim();
        if (value.isEmpty()) {
            throw BizException.of(ErrorCode.PARAM_INVALID, "请输入手机号或邮箱");
        }
        if (value.contains("@")) {
            if (!EMAIL.matcher(value).matches()) {
                throw BizException.of(ErrorCode.PARAM_INVALID, "邮箱格式不正确");
            }
            return new AccountIdentifier(Type.EMAIL, value.toLowerCase());
        }
        if (value.length() == PHONE_LENGTH && PHONE.matcher(value).matches()) {
            return new AccountIdentifier(Type.PHONE, value);
        }
        throw BizException.of(ErrorCode.PARAM_INVALID, "请输入 11 位手机号或完整邮箱地址");
    }

    public boolean isPhone() {
        return type == Type.PHONE;
    }

    /** 给日志与提示用：邮箱脱敏成 a***@b.com，手机号脱敏成 138****8000 */
    public String masked() {
        if (isPhone()) {
            return value.substring(0, 3) + "****" + value.substring(7);
        }
        int at = value.indexOf('@');
        String local = value.substring(0, at);
        String domain = value.substring(at);
        if (local.length() <= 1) {
            return "*" + domain;
        }
        return local.charAt(0) + "***" + domain;
    }
}
