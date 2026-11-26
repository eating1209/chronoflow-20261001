package com.chronoflow.agent.service;

/**
 * 「OCR 文字 → 安排草稿」里的一条（spec §4.1.9，`POST /ai/events/parse-text`）。
 *
 * <p>`kind` 是 EVENT（日程）或 TASK（待办）。不能靠「有没有时间」判断：
 * 待办也可能有截止时间，只看时间会把登记 / 交材料误判成日程。
 *
 * @param title        事项名（必填；没标题的条目在解析阶段就丢掉了）
 * @param kind         安排类型：{@code EVENT} 日程 / {@code TASK} 待办
 * @param at           时间点，**ISO-8601 字符串且带偏移量**（如 `2026-09-24T00:00:00+08:00`）；
 *                     **为 null / 字段缺失表示「没写日期」是合法结果**——不拿今天兜底，
 *                     由 App 的确认页让用户补。字符串而不是 OffsetDateTime：Jackson 会把
 *                     OffsetDateTime 归一成 UTC，客户端看到 `2026-09-24T16:00:00Z`，
 *                     再想判断「是不是当天 00:00（只说了哪天）」就得自己换算，不如直接给原时区
 * @param timezone     解释 `at` 的时区（固定回带请求时区），客户端靠它把时间落到正确的那一天
 * @param locationName 地点，可空
 * @param description  备注 / 登记路径 / 要交的材料，可空
 */
public record ParsedEventDraft(String title,
                               String kind,
                               String at,
                               String timezone,
                               String locationName,
                               String description) {
}
