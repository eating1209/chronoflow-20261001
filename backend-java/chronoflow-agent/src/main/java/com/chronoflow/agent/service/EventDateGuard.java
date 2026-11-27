package com.chronoflow.agent.service;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.function.Consumer;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 「周 X」与模型算出来的日期对不上时，把日期拉回同一个星期。
 *
 * <p><b>为什么需要</b>：2026-11-03（周二）用「本周四下午 2 点开会」调解析，模型返回 2026-11-06，
 * 那是周五。掐掉了模型做日历心算的能力（提示词给了 14 天对照表）也不能全信模型，
 * 所以这里再兜一层：提示词是「尽量让它算对」，这段代码是「算错了也不会把错日期交给用户」。
 *
 * <p><b>只纠星期，不纠周次</b>：文字里写了「周四」，而模型给的日期是周五，说明它差了一天，
 * 这时把它挪到离得最近的那个周四即可（周五 → 前一天的周四）。至于它选的是本周还是下周，
 * 提示词里的对照表已经负责了一半，这里不重复猜——猜错会把「下周四」变成「本周四」，比不纠更糟。
 *
 * <p><b>有歧义就不动</b>：一段 OCR 文字里可能同时出现「周一」和「周五」（例如聊天记录里两个约会），
 * 这时无法判断这一条对应哪一个，原样保留并记 WARN，让用户在确认页自己看。
 *
 * <p>与 Python 版 {@code app/services/event_date_guard.py} 行为一致（两版后端契约相同）。
 */
public final class EventDateGuard {

    /** 「周一 / 星期四 / 礼拜天」都算；前面带「本 / 这 / 下」不影响判断（只用来判断星期几）。 */
    private static final Pattern WEEKDAY_MENTION =
            Pattern.compile("(?:周|星期|礼拜)\\s*([一二三四五六日天])");

    private static final String[] WEEKDAY_CN = {"周一", "周二", "周三", "周四", "周五", "周六", "周日"};

    /** 对照表覆盖的天数：够日常通知用（下周的会），再远的不该靠模型猜。 */
    public static final int TABLE_DAYS = 14;

    private EventDateGuard() {
    }

    /** 星期几的中文写法（提示词对照表与日志都用它）。 */
    public static String weekdayCn(DayOfWeek day) {
        return WEEKDAY_CN[day.getValue() - 1];
    }

    /**
     * 提示词里的「14 天对照表」：每行「日期 + 星期」，前两天标注今天/明天。
     *
     * <p>模型最不可靠的地方就是「今天星期几」，把答案直接摊在它面前比让它推更省事。
     */
    public static String dateTable(LocalDate today, int days) {
        StringBuilder table = new StringBuilder();
        for (int i = 0; i < days; i++) {
            LocalDate day = today.plusDays(i);
            if (i > 0) {
                table.append('\n');
            }
            table.append("- ").append(day).append(' ').append(weekdayCn(day.getDayOfWeek()));
            if (i == 0) {
                table.append("（今天）");
            } else if (i == 1) {
                table.append("（明天）");
            } else if (i == 2) {
                table.append("（后天）");
            }
        }
        return table.toString();
    }

    /** 从 OCR 文字里收集提到过的星期；一个都没有就返回空集合（纯绝对日期/无日期）。 */
    public static Set<DayOfWeek> mentionedWeekdays(String text) {
        if (text == null || text.isEmpty()) {
            return EnumSet.noneOf(DayOfWeek.class);
        }
        Set<DayOfWeek> days = EnumSet.noneOf(DayOfWeek.class);
        Matcher matcher = WEEKDAY_MENTION.matcher(text);
        while (matcher.find()) {
            DayOfWeek day = fromCn(matcher.group(1).charAt(0));
            if (day != null) {
                days.add(day);
            }
        }
        return days;
    }

    /**
     * 把每一份草稿的日期按文字里的星期纠一遍。
     *
     * @param text   OCR 原文（纠正依据只有它，不引入别的信息）
     * @param drafts 模型给的草稿；`at` 为空（没写日期）的条目原样返回
     * @param zone   解释 `at` 的时区
     * @param warn   纠正 / 无法判断时的日志出口（含原值与纠正值，便于回归排查）
     */
    public static List<ParsedEventDraft> apply(String text, LocalDate today,
                                               List<ParsedEventDraft> drafts, ZoneId zone,
                                               Consumer<String> warn) {
        Set<DayOfWeek> mentioned = mentionedWeekdays(text);
        if (mentioned.isEmpty() || drafts == null || drafts.isEmpty()) {
            return drafts;
        }
        List<ParsedEventDraft> guarded = new ArrayList<>(drafts.size());
        for (ParsedEventDraft draft : drafts) {
            guarded.add(fix(draft, mentioned, zone, warn));
        }
        return guarded;
    }

    private static ParsedEventDraft fix(ParsedEventDraft draft, Set<DayOfWeek> mentioned,
                                        ZoneId zone, Consumer<String> warn) {
        String at = draft.at();
        if (at == null || at.isBlank()) {
            return draft;
        }
        OffsetDateTime original;
        try {
            original = OffsetDateTime.parse(at);
        } catch (DateTimeParseException ex) {
            // 时间格式本来就不合法：那是另一件事，别在这里静默改数据
            return draft;
        }
        LocalDate date = original.atZoneSameInstant(zone).toLocalDate();
        if (mentioned.contains(date.getDayOfWeek())) {
            return draft;
        }
        if (mentioned.size() > 1) {
            warn.accept("日期校验：文字里提到多个星期 " + mentioned + "，无法判断该对应哪一个，保留原值 "
                    + date + "（标题：" + draft.title() + "）");
            return draft;
        }
        DayOfWeek target = mentioned.iterator().next();
        int shift = nearestShift(date.getDayOfWeek(), target);
        OffsetDateTime corrected = original.plusDays(shift);
        warn.accept("日期校验：文字说「" + weekdayCn(target) + "」，模型给的是 " + date
                + "（" + weekdayCn(date.getDayOfWeek()) + "），已纠正为 "
                + corrected.atZoneSameInstant(zone).toLocalDate() + "（标题：" + draft.title() + "）");
        // 只改日期，其余字段（含 kind）原样透传：
        // 漏传 kind 会把「待办」悄悄变成日程，用户看到的类型就错了。
        return new ParsedEventDraft(draft.title(), draft.kind(), corrected.toString(),
                draft.timezone(), draft.locationName(), draft.description());
    }

    /** 离得最近的那一天（-3..+3）；同一天用 0 表示不需要动。 */
    static int nearestShift(DayOfWeek current, DayOfWeek target) {
        int forward = (target.getValue() - current.getValue() + 7) % 7;
        return forward <= 3 ? forward : forward - 7;
    }

    private static DayOfWeek fromCn(char c) {
        return switch (c) {
            case '一' -> DayOfWeek.MONDAY;
            case '二' -> DayOfWeek.TUESDAY;
            case '三' -> DayOfWeek.WEDNESDAY;
            case '四' -> DayOfWeek.THURSDAY;
            case '五' -> DayOfWeek.FRIDAY;
            case '六' -> DayOfWeek.SATURDAY;
            case '日', '天' -> DayOfWeek.SUNDAY;
            default -> null;
        };
    }
}
