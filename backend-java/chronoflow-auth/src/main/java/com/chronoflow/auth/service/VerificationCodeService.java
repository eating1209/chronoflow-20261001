package com.chronoflow.auth.service;

import com.chronoflow.auth.config.AuthProperties;
import com.chronoflow.auth.dto.AuthDtos;
import com.chronoflow.auth.dto.AuthDtos.SendSmsCodeResponse;
import com.chronoflow.auth.mail.EmailSender;
import com.chronoflow.auth.sms.SmsSender;
import com.chronoflow.auth.store.VerificationCodeStore;
import com.chronoflow.common.api.ErrorCode;
import com.chronoflow.common.exception.BizException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.Duration;
import java.util.regex.Pattern;

/**
 * 短信验证码的发送与校验，规则见 spec §3.6。
 *
 * <p>发送通道由 {@link SmsSender} 决定：开发环境是「不真发 + 响应回显」（{@code expose-sms-code=true}），
 * 部署环境接阿里云短信（{@code chronoflow.auth.sms.provider=aliyun}）。
 */
@Service
public class VerificationCodeService {

    private static final Logger log = LoggerFactory.getLogger(VerificationCodeService.class);
    private static final Duration DAILY_WINDOW = Duration.ofDays(1);

    private final VerificationCodeStore store;
    private final AuthProperties properties;
    private final SmsSender smsSender;
    /** 邮箱账号走这个通道；与短信共用同一套验证码存储与频控 */
    private final EmailSender emailSender;
    private final SecureRandom random = new SecureRandom();

    public VerificationCodeService(VerificationCodeStore store,
                                   AuthProperties properties,
                                   SmsSender smsSender,
                                   EmailSender emailSender) {
        this.store = store;
        this.properties = properties;
        this.smsSender = smsSender;
        this.emailSender = emailSender;
    }

    /**
     * 发送登录验证码。`account` 可以是手机号或邮箱，由 {@link AccountIdentifier} 识别：
     * 手机号走短信通道，邮箱走邮件通道——两条通道共用同一套验证码存储、
     * 同一套频控与失败计数（键都是账号本身），所以登录时的 {@link #verify} 不用区分类型。
     *
     * <p>**为什么不拆成两个端点**：客户端只有一个输入框，拆端点等于让客户端先判断类型；
     * 判断错就是一次无谓的失败请求，而且前后端两套判断规则迟早会不一致。
     */
    public SendSmsCodeResponse send(String rawAccount, String clientIp) {
        AccountIdentifier identifier = AccountIdentifier.parse(rawAccount);
        String account = identifier.value();

        // 频控按账号类型分开计：手机号的短信配额不该被邮箱账号吃掉
        String counterKind = identifier.isPhone() ? "phone" : "email";
        long accountCount = store.incrementDailyCount(counterKind, account, DAILY_WINDOW);
        if (accountCount > properties.getSmsDailyLimitPerPhone()) {
            throw BizException.of(ErrorCode.SMS_SEND_TOO_FREQUENT,
                    identifier.isPhone() ? "该手机号今日验证码发送次数已达上限" : "该邮箱今日验证码发送次数已达上限");
        }
        if (clientIp != null && !clientIp.isBlank()) {
            long ipCount = store.incrementDailyCount("ip", clientIp, DAILY_WINDOW);
            if (ipCount > properties.getSmsDailyLimitPerIp()) {
                throw BizException.of(ErrorCode.SMS_SEND_TOO_FREQUENT, "当前网络今日验证码发送次数已达上限");
            }
        }

        if (!store.tryAcquireSendLock(account, properties.getSmsSendInterval())) {
            throw BizException.of(ErrorCode.SMS_SEND_TOO_FREQUENT);
        }

        String code = String.format("%06d", random.nextInt(1_000_000));
        store.saveCode(account, code, properties.getSmsCodeTtl());
        store.clearVerifyFailure(account);

        try {
            if (identifier.isPhone()) {
                smsSender.sendVerificationCode(account, code);
            } else {
                emailSender.sendVerificationCode(account, code);
            }
        } catch (RuntimeException ex) {
            // 没发出去就别把用户锁在 60 秒频控里：清掉验证码与发送锁，让他立刻重试
            store.deleteCode(account);
            store.releaseSendLock(account);
            log.warn("验证码发送失败 account={} reason={}", identifier.masked(), ex.getMessage());
            throw ex;
        }
        log.info("已发送登录验证码 account={} channel={}",
                identifier.masked(), identifier.isPhone() ? "sms" : "email");

        return new SendSmsCodeResponse(
                properties.getSmsCodeTtl().toSeconds(),
                exposeCode() ? code : null);
    }

    /**
     * 是否在响应里回显验证码。
     *
     * <p>接了真实短信通道就**永不回显**——哪怕有人误把 {@code expose-sms-code} 打开，
     * 也不能让接口把验证码直接吐出来（那是把账号拱手送人）。
     */
    private boolean exposeCode() {
        return properties.isExposeSmsCode() && !"aliyun".equals(properties.getSms().getProvider());
    }

    /**
     * 校验验证码。校验成功后立即失效，避免重放。
     */
    public void verify(String phone, String code) {
        if (isReviewLogin(phone, code)) {
            // 应用市场审核期间：审核员拿不到我们手机上的短信，用固定验证码放行。
            // 只对配置里那一个手机号生效，清空配置即彻底失效（见 AuthProperties#reviewLoginPhone）。
            store.deleteCode(phone);
            store.clearVerifyFailure(phone);
            log.warn("审核专用固定验证码登录 phone={}（仅审核期，审核结束后请清空 CHRONOFLOW_REVIEW_LOGIN_*）",
                    maskPhone(phone));
            return;
        }
        String expected = store.findCode(phone)
                .orElseThrow(() -> BizException.of(ErrorCode.SMS_CODE_INVALID));
        if (!expected.equals(code)) {
            long failures = store.incrementVerifyFailure(phone, properties.getSmsCodeTtl());
            if (failures >= properties.getSmsMaxVerifyAttempts()) {
                store.deleteCode(phone);
                store.clearVerifyFailure(phone);
            }
            throw BizException.of(ErrorCode.SMS_CODE_INVALID);
        }
        store.deleteCode(phone);
        store.clearVerifyFailure(phone);
    }

    /**
     * 命中的是不是「审核专用账号 + 固定验证码」。
     *
     * <p>两个配置任一为空都直接返回 false —— 线上默认就是空，功能天然关闭。
     * 比较用等值而不是前缀/包含，避免大小写、空白之类的小把戏。
     */
    private boolean isReviewLogin(String phone, String code) {
        String reviewPhone = properties.getReviewLoginPhone();
        String reviewCode = properties.getReviewLoginCode();
        if (reviewPhone == null || reviewPhone.isBlank() || reviewCode == null || reviewCode.isBlank()) {
            return false;
        }
        return reviewPhone.trim().equals(phone) && reviewCode.trim().equals(code);
    }

    private String maskPhone(String phone) {
        return phone.length() >= 11
                ? phone.substring(0, 3) + "****" + phone.substring(7)
                : "***";
    }
}
