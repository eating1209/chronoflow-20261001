package com.chronoflow.auth.store;

import java.time.Duration;
import java.util.Optional;

/**
 * 短信验证码存储：验证码、发送频控锁与日限额计数。
 */
public interface VerificationCodeStore {

    void saveCode(String phone, String code, Duration ttl);

    Optional<String> findCode(String phone);

    void deleteCode(String phone);

    /**
     * 尝试获取发送锁，成功返回 true。用于「同手机号 60 秒 1 条」频控。
     */
    boolean tryAcquireSendLock(String phone, Duration ttl);

    /**
     * 释放发送锁。**只在短信真的没发出去时用**：否则用户被 60 秒频控锁住，
     * 却连一次验证码都没收到。
     */
    void releaseSendLock(String phone);

    /**
     * 递增日计数并返回递增后的值。dimension 取 {@code phone} 或 {@code ip}。
     */
    long incrementDailyCount(String dimension, String value, Duration ttl);

    /**
     * 记录一次校验失败次数并返回当前失败次数。
     */
    long incrementVerifyFailure(String phone, Duration ttl);

    void clearVerifyFailure(String phone);

    /**
     * 当前密码错误次数（不递增）。用于「是否已经锁住」的判定。
     */
    long countPasswordFailures(String phone);

    /**
     * 记录一次密码错误并返回累计次数。窗口期内达到上限就锁定一段时间，
     * 防止脚本对着 11 位手机号穷举密码。
     */
    long incrementPasswordFailure(String phone, Duration ttl);

    void clearPasswordFailure(String phone);
}
