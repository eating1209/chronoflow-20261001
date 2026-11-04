"""「周 X」与模型给的日期对不上时，把日期拉回同一个星期。

Java 版是 `chronoflow-agent` 的 `EventDateGuard`，两边行为必须一致（同一份接口契约）。

为什么要它：2026-11-03（周二）用「本周四下午 2 点开会」调解析，模型返回 2026-11-06，
那是周五。提示词里给了 14 天对照表，但那是「尽量让它抄对」；这一段是
「抄错了也不把错日期交给用户」。

只纠星期、不纠周次：文字写「周四」而模型给了周五，挪到最近的那个周四即可；
它选的是本周还是下周，交给提示词里的对照表，这里再猜一次反而会把「下周四」拉成「本周四」。

有歧义就不动：一段 OCR 里同时出现「周一」和「周五」时无法判断这一条对应哪个，
原样保留并给出说明，让用户在确认页自己看。
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

# 「周一 / 星期四 / 礼拜天」都算；前面带「本 / 这 / 下」不影响判断（只用来看星期几）
WEEKDAY_RE = re.compile(r"(?:周|星期|礼拜)\s*([一二三四五六日天])")

WEEKDAY_CN = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

# 字符 → 0=周一 … 6=周日
CN_TO_INDEX = {
    "一": 0,
    "二": 1,
    "三": 2,
    "四": 3,
    "五": 4,
    "六": 5,
    "日": 6,
    "天": 6,
}

# 对照表覆盖的天数：够日常通知用（下周的会），再远的不该靠模型猜
TABLE_DAYS = 14


def date_table(today: date, days: int = TABLE_DAYS) -> str:
    """提示词里的「14 天对照表」：每行「日期 + 星期」，前两天标注今天/明天。"""
    lines: list[str] = []
    for offset in range(days):
        day = today + timedelta(days=offset)
        line = f"- {day.isoformat()} {weekday_cn(day.weekday())}"
        if offset == 0:
            line += "（今天）"
        elif offset == 1:
            line += "（明天）"
        elif offset == 2:
            line += "（后天）"
        lines.append(line)
    return "\n".join(lines)


def weekday_cn(index: int) -> str:
    """0=周一 … 6=周日 → 「周一」…「周日」。"""
    return WEEKDAY_CN[index]


def mentioned_weekdays(text: str | None) -> set[int]:
    """从 OCR 文字里收集提到过的星期（0=周一…6=周日）；一个都没有就返回空集合。"""
    if not text:
        return set()
    found: set[int] = set()
    for match in WEEKDAY_RE.finditer(text):
        index = CN_TO_INDEX.get(match.group(1))
        if index is not None:
            found.add(index)
    return found


def nearest_shift(current: int, target: int) -> int:
    """离得最近的那一天（-3..+3）；同一天返回 0。"""
    forward = (target - current) % 7
    return forward if forward <= 3 else forward - 7


def guard_at(text: str | None, at: str | None, zone: ZoneInfo) -> tuple[str | None, str | None]:
    """按文字里的星期纠正一个 `at`。

    返回 `(新的 at, 纠正说明)`；不需要纠正时原样返回 `at` 并与 `None` 一起返回，
    调用方据此决定是否记日志。
    """
    if not at:
        return at, None
    weekdays = mentioned_weekdays(text)
    if not weekdays:
        return at, None
    try:
        parsed = datetime.fromisoformat(at)
    except ValueError:
        # 时间格式本来就不合法：那是另一件事，别在这里静默改数据
        return at, None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=zone)
    local_day = parsed.astimezone(zone).date()
    if local_day.weekday() in weekdays:
        return at, None
    if len(weekdays) > 1:
        names = "、".join(weekday_cn(i) for i in sorted(weekdays))
        return at, f"文字里提到多个星期（{names}），无法判断该对应哪一个，保留原值 {local_day}"
    target = next(iter(weekdays))
    corrected = parsed + timedelta(days=nearest_shift(local_day.weekday(), target))
    return (
        corrected.isoformat(),
        f"文字说「{weekday_cn(target)}」，模型给的是 {local_day}"
        f"（{weekday_cn(local_day.weekday())}），已纠正为 {corrected.astimezone(zone).date()}",
    )
