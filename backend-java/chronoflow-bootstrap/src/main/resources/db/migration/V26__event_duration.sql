-- 日程从「单个时间点」改为「开始时间 + 时长」。
--
-- 保留 at 作为开始时间，只增加 duration_minutes：
--   * NULL = 旧数据 / 点状日程，App 按 60 分钟显示；
--   * > 0  = 持续分钟数，结束时间 = at + duration_minutes。
ALTER TABLE event ADD COLUMN duration_minutes INTEGER;

ALTER TABLE event
    ADD CONSTRAINT ck_event_duration CHECK (duration_minutes IS NULL OR duration_minutes > 0);
