-- 待办也支持结构化地点：交材料、取快递这类事情同样需要记住去哪儿。
-- 字段与 event 的地点列保持同一套规范，便于互转与后续导航（spec §5.9）。

ALTER TABLE task
    ADD COLUMN location_name      VARCHAR(128),
    ADD COLUMN location_address   VARCHAR(255),
    ADD COLUMN location_detail    VARCHAR(255),
    ADD COLUMN latitude           NUMERIC(10, 7),
    ADD COLUMN longitude          NUMERIC(10, 7),
    ADD COLUMN poi_id             VARCHAR(64),
    ADD COLUMN coordinate_system  VARCHAR(16);

ALTER TABLE task
    ADD CONSTRAINT ck_task_coordinate_system
        CHECK (coordinate_system IS NULL OR coordinate_system IN ('GCJ-02', 'WGS-84')),
    ADD CONSTRAINT ck_task_coordinate_pair CHECK (
        (latitude IS NULL AND longitude IS NULL)
        OR (latitude IS NOT NULL AND longitude IS NOT NULL AND coordinate_system IS NOT NULL)
    ),
    ADD CONSTRAINT ck_task_latitude CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
    ADD CONSTRAINT ck_task_longitude CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));

CREATE INDEX idx_task_poi ON task (poi_id) WHERE poi_id IS NOT NULL;
