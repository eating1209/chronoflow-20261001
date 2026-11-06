package com.chronoflow.auth.service;

import com.chronoflow.auth.dto.AuthDtos.TrainingDataView;
import com.chronoflow.auth.entity.Identity;
import com.chronoflow.auth.mapper.IdentityMapper;
import com.chronoflow.auth.mapper.TrainingSampleMapper;
import com.chronoflow.common.api.ErrorCode;
import com.chronoflow.common.exception.BizException;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;

/** 训练数据同意、脱敏采样与到期清理（任务 5）。 */
@Service
public class TrainingDataService {

    public static final int RETENTION_DAYS = 90;
    private static final String SOURCE_VISION_TEXT = "VISION_TEXT";
    private static final Logger log = LoggerFactory.getLogger(TrainingDataService.class);

    private final IdentityMapper identityMapper;
    private final TrainingSampleMapper sampleMapper;
    private final ObjectMapper objectMapper;

    public TrainingDataService(IdentityMapper identityMapper,
                               TrainingSampleMapper sampleMapper,
                               ObjectMapper objectMapper) {
        this.identityMapper = identityMapper;
        this.sampleMapper = sampleMapper;
        this.objectMapper = objectMapper;
    }

    public TrainingDataView view(Long identityId) {
        Identity identity = requireIdentity(identityId);
        return new TrainingDataView(Boolean.TRUE.equals(identity.getTrainingDataOptIn()), RETENTION_DAYS);
    }

    /** 单独同意开关。关闭时立即删除已有样本，而不是“等过期”。 */
    @Transactional
    public TrainingDataView setEnabled(Long identityId, boolean enabled) {
        Identity identity = requireIdentity(identityId);
        identity.setTrainingDataOptIn(enabled);
        identity.setTrainingDataOptedInAt(enabled ? OffsetDateTime.now() : null);
        identityMapper.updateById(identity);
        if (!enabled) {
            sampleMapper.deleteForIdentity(identityId);
        }
        return new TrainingDataView(enabled, RETENTION_DAYS);
    }

    /**
     * 记录一条脱敏样本。任何异常都只影响采样，绝不影响用户拿到解析结果。
     *
     * @return true 表示确实入库；关闭开关、模型没抽出条目或存储失败都返回 false
     */
    public boolean captureVisionText(Long identityId, String rawText, Object parsedItems) {
        if (rawText == null || rawText.isBlank() || parsedItems == null) {
            return false;
        }
        try {
            String redactedText = TrainingDataRedactor.redact(rawText).strip();
            if (redactedText.isEmpty()) {
                return false;
            }
            String redactedJson = TrainingDataRedactor.redact(objectMapper.writeValueAsString(parsedItems));
            return sampleMapper.insertIfOptedIn(
                    identityId, SOURCE_VISION_TEXT, redactedText, redactedJson, RETENTION_DAYS) > 0;
        } catch (JsonProcessingException | RuntimeException ex) {
            // 不记录原文 / 异常消息里的内容：采样失败时也不能把敏感文字带进日志
            log.warn("训练样本写入失败（用户 {}），本次解析结果不受影响", identityId);
            return false;
        }
    }

    @Scheduled(cron = "${chronoflow.training-data.cleanup-cron:0 20 3 * * *}",
            zone = "${chronoflow.training-data.cleanup-zone:Asia/Shanghai}")
    public void purgeExpired() {
        int deleted = sampleMapper.deleteExpired();
        if (deleted > 0) {
            log.info("已删除 {} 条到期训练样本", deleted);
        }
    }

    private Identity requireIdentity(Long identityId) {
        Identity identity = identityMapper.selectById(identityId);
        if (identity == null) {
            throw BizException.of(ErrorCode.IDENTITY_UNAVAILABLE);
        }
        return identity;
    }
}
