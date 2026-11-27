package com.chronoflow.agent.service;

import org.junit.jupiter.api.Test;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 「周四被算成周五」那个 bug（2026-11-03，P1）的回归测试。
 *
 * <p>用例直接抄自 bug 报告 §5.4 的验收表：那天是周二，模型把「本周四」算成了 11-06（周五）。
 * 这里测的是**兜底**这一层——提示词那边是「让它抄对」，这层是「抄错了也不发给用户」。
 */
class EventDateGuardTest {

    private static final ZoneId ZONE = ZoneId.of("Asia/Shanghai");
    /** bug 发生那天：2026-11-03，星期二。 */
    private static final LocalDate TODAY = LocalDate.parse("2026-11-03");

    private static ParsedEventDraft draft(String at) {
        return new ParsedEventDraft("开会", "EVENT", at, "Asia/Shanghai", null, null);
    }

    private static String guardOne(String text, String at) {
        List<String> warns = new ArrayList<>();
        List<ParsedEventDraft> guarded = EventDateGuard.apply(
                text, TODAY, List.of(draft(at)), ZONE, warns::add);
        return guarded.get(0).at();
    }

    @Test
    void acceptanceCasesFromTheBugReport() {
        // 输入 → 期望日期（bug 报告 §5.4）
        assertThat(guardOne("今天下午4点开会", "2026-11-03T16:00:00+08:00")).startsWith("2026-11-03");
        assertThat(guardOne("明天下午3点开会", "2026-11-04T15:00:00+08:00")).startsWith("2026-11-04");
        assertThat(guardOne("后天下午3点开会", "2026-11-05T15:00:00+08:00")).startsWith("2026-11-05");
        assertThat(guardOne("周四下午3点30开会", "2026-11-06T15:30:00+08:00")).startsWith("2026-11-05");
        assertThat(guardOne("本周四下午2点开会", "2026-11-06T14:00:00+08:00")).startsWith("2026-11-05");
        assertThat(guardOne("本周五下午2点开会", "2026-11-07T14:00:00+08:00")).startsWith("2026-11-06");
        // 原本就对的不动
        assertThat(guardOne("本周一下午2点开会", "2026-11-02T14:00:00+08:00")).startsWith("2026-11-02");
        assertThat(guardOne("本周六下午2点开会", "2026-11-07T14:00:00+08:00")).startsWith("2026-11-07");
        assertThat(guardOne("本周日下午2点开会", "2026-11-08T14:00:00+08:00")).startsWith("2026-11-08");
    }

    @Test
    void keepsTheTimeOfDayWhenOnlyTheWeekdayIsWrong() {
        // 只挪日期，不能把 15:30 改成 00:00——纠正星期不等于重新猜时刻
        assertThat(guardOne("周四下午3点30开会", "2026-11-06T15:30:00+08:00"))
                .isEqualTo("2026-11-05T15:30+08:00");
    }

    @Test
    void leavesDraftsWithoutDateAlone() {
        List<ParsedEventDraft> guarded = EventDateGuard.apply(
                "本周四要交材料", TODAY, List.of(draft(null)), ZONE, msg -> { });
        assertThat(guarded.get(0).at()).isNull();
    }

    @Test
    void leavesTextWithoutWeekdayAlone() {
        // 没有「周 X」就没有纠正依据：模型算错的绝对日期这里不猜
        assertThat(guardOne("11月6日下午3点开会", "2026-11-06T15:00:00+08:00"))
                .startsWith("2026-11-06");
    }

    @Test
    void keepsOriginalWhenSeveralWeekdaysAreMentioned() {
        // 聊天记录里常有多个约会：周一和周五都提到、日期又都不是，这时不该硬猜
        List<String> warns = new ArrayList<>();
        List<ParsedEventDraft> guarded = EventDateGuard.apply(
                "周一交材料，周五开会", TODAY,
                List.of(draft("2026-11-06T15:00:00+08:00")), ZONE, warns::add);
        // 11-06 是周五，本来就对得上「周五」，所以不改、也不告警
        assertThat(guarded.get(0).at()).startsWith("2026-11-06");
        assertThat(warns).isEmpty();

        warns.clear();
        guarded = EventDateGuard.apply(
                "周一交材料，周五开会", TODAY,
                List.of(draft("2026-11-04T15:00:00+08:00")), ZONE, warns::add);
        // 11-04 是周三，两个星期说法都对不上 → 保留原值并告警，等用户确认
        assertThat(guarded.get(0).at()).startsWith("2026-11-04");
        assertThat(warns).hasSize(1);
        assertThat(warns.get(0)).contains("多个星期");
    }

    @Test
    void tableStartsWithTodayAndItsWeekday() {
        String table = EventDateGuard.dateTable(TODAY, 3);
        assertThat(table.split("\n")).containsExactly(
                "- 2026-11-03 周二（今天）",
                "- 2026-11-04 周三（明天）",
                "- 2026-11-05 周四（后天）");
    }

    @Test
    void weekdayMentionsAreCollectedFromAllSpellings() {
        assertThat(EventDateGuard.mentionedWeekdays("周四下午开会"))
                .isEqualTo(Set.of(DayOfWeek.THURSDAY));
        assertThat(EventDateGuard.mentionedWeekdays("星期四 / 礼拜天 / 周日"))
                .isEqualTo(Set.of(DayOfWeek.THURSDAY, DayOfWeek.SUNDAY));
        assertThat(EventDateGuard.mentionedWeekdays("11月6日下午3点")).isEmpty();
        assertThat(EventDateGuard.mentionedWeekdays(null)).isEmpty();
    }
}
