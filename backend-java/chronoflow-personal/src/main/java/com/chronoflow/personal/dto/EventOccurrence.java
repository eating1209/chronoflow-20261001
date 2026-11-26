package com.chronoflow.personal.dto;

import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;

/**
 * 日程实例。重复日程在查询范围内展开后的单次出现。
 *
 * @param occurrenceDate 该次出现的本地日期，用于定位重复例外；非重复日程为 null
 * @param modified       是否被例外单独修改过
 */
public record EventOccurrence(Long eventId,
                              Long calendarId,
                              String title,
                              String description,
                              String locationName,
                              String locationAddress,
                              String locationDetail,
                              Instant at,
                              Integer durationMinutes,
                              String timezone,
                              boolean recurring,
                              LocalDate occurrenceDate,
                              boolean modified,
                              boolean done,
                              OffsetDateTime completedAt) {

    public EventOccurrence withCompletion(boolean done, OffsetDateTime completedAt) {
        return new EventOccurrence(
                eventId,
                calendarId,
                title,
                description,
                locationName,
                locationAddress,
                locationDetail,
                at,
                durationMinutes,
                timezone,
                recurring,
                occurrenceDate,
                modified,
                done,
                completedAt);
    }
}
