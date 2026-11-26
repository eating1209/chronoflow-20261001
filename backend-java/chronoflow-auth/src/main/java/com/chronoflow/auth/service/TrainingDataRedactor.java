package com.chronoflow.auth.service;

import java.util.regex.Pattern;

/**
 * 训练样本脱敏。Java 与 Python 两边使用同一组规则，改规则时两边必须一起改。
 *
 * <p>只做**不可逆替换**，不做可还原的掩码（例如保留后四位）：训练样本一旦泄露，
 * 保留任何可关联到个人的片段都不符合任务 5 的验收口径。
 */
public final class TrainingDataRedactor {

    private static final Pattern PHONE = Pattern.compile(
            "(?<!\\d)(?:\\+?86[\\s-]?)?1[3-9]\\d{9}(?!\\d)");
    private static final Pattern ID_CARD = Pattern.compile("(?<!\\d)\\d{17}[\\dXx](?!\\d)");
    private static final Pattern LABELED_NAME = Pattern.compile(
            "(姓名|联系人|收件人|参会人|负责人|班主任)[\\s:：]+[\\u4e00-\\u9fa5·]{2,8}");
    private static final Pattern ROLE_NAME = Pattern.compile(
            "([\\u4e00-\\u9fa5]{1,4})(老师|同学|经理|主任|书记|部长|医生|阿姨|叔叔|师傅)");

    private TrainingDataRedactor() {
    }

    public static String redact(String raw) {
        if (raw == null || raw.isBlank()) {
            return raw;
        }
        String redacted = PHONE.matcher(raw).replaceAll("[手机号]");
        redacted = ID_CARD.matcher(redacted).replaceAll("[身份证号]");
        redacted = LABELED_NAME.matcher(redacted).replaceAll("$1：[姓名]");
        return ROLE_NAME.matcher(redacted).replaceAll("[姓名]$2");
    }
}
