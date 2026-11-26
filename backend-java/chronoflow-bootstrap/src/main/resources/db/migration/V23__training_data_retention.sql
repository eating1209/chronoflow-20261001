-- 任务 5：服务端训练样本的单独同意与保留期限。
--
-- 红线（docs/01-产品/任务总表-2026-10-23会议.md §任务 5）：
--   * 训练用途必须单独 opt-in，不能混在“同意隐私政策”里；
--   * 默认关闭，关闭后不再产生新样本；
--   * 默认不保留原图——本功能只接收手机端 OCR 出来的文字，原图不出手机；
--   * 入库前脱敏手机号、身份证号、姓名；
--   * 保留 90 天，到期由服务端任务删除。
ALTER TABLE identity
    ADD COLUMN training_data_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN training_data_opted_in_at TIMESTAMPTZ;

CREATE TABLE training_sample (
    id BIGSERIAL PRIMARY KEY,
    identity_id BIGINT NOT NULL REFERENCES identity (id) ON DELETE CASCADE,
    source VARCHAR(32) NOT NULL,
    -- 只存脱敏后的 OCR 文字；原图从未上传到这里，原始文字也不入库。
    redacted_text TEXT NOT NULL,
    -- 模型抽取结果，同样经过脱敏后再序列化
    parsed_json JSONB NOT NULL,
    sample_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT ck_training_sample_source CHECK (source IN ('VISION_TEXT')),
    CONSTRAINT ck_training_sample_text_length CHECK (char_length(redacted_text) BETWEEN 1 AND 4000),
    CONSTRAINT ck_training_sample_expiry CHECK (expires_at > created_at)
);

CREATE INDEX idx_training_sample_identity ON training_sample (identity_id, created_at DESC);
CREATE INDEX idx_training_sample_expiry ON training_sample (expires_at);

COMMENT ON COLUMN identity.training_data_opt_in IS '是否单独同意将脱敏后的 OCR 文字用于模型改进（默认 false）';
COMMENT ON COLUMN identity.training_data_opted_in_at IS '最近一次同意训练用途的时间；关闭时置空';
COMMENT ON TABLE training_sample IS '脱敏后的日程解析训练样本；不含原图和原始 OCR 文字，保留 90 天';
