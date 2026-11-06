-- 日程完成状态（需求 9 / L2）。
--
-- 完成状态按「人 + 日程 + 这一次出现」保存：
--   * 非重复日程的 occurrence_date 为 NULL；
--   * 重复日程只影响勾掉的那一次，不把整条序列结束掉；
--   * 组织下发的日程属于别人，完成与否必须按查看者分别记录。
CREATE TABLE event_completion (
    id              BIGSERIAL PRIMARY KEY,
    event_id        BIGINT      NOT NULL,
    identity_id     BIGINT      NOT NULL,
    occurrence_date DATE,
    completed_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_event_completion_event FOREIGN KEY (event_id) REFERENCES event (id) ON DELETE CASCADE,
    CONSTRAINT fk_event_completion_identity FOREIGN KEY (identity_id) REFERENCES identity (id) ON DELETE CASCADE
);

-- 普通唯一索引对 NULL 不生效，因此把「非重复日程」归一成一个哨兵日期。
CREATE UNIQUE INDEX uk_event_completion
    ON event_completion (event_id, identity_id, COALESCE(occurrence_date, '-infinity'::date));

CREATE INDEX idx_event_completion_identity
    ON event_completion (identity_id, event_id);
