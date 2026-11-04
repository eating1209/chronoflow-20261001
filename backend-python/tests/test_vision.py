"""拍照识别日程的解析与容错（spec §4.1.9）。

不依赖真实模型：模型不是被测对象，我们这一侧才是——提示词有没有把
「一图多事项」「跨天只记起始那天」「看不清时间不要猜」交代清楚、
回复里的代码块/夹带文字/尾逗号能不能吃下来、未配置时会不会老实报错。
"""

from __future__ import annotations

from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
JAVA_VISION_PROMPT = (
    REPO_ROOT / "backend-java" / "chronoflow-agent" / "src" / "main" / "resources"
    / "agent" / "vision-prompt.md"
)

# 注意：**不要**在模块导入期 import app.services.vision —— 它会在 conftest 设置
# DATABASE_URL 之前就把 app.config 读进内存，于是整套用例跑去连开发库（踩过）。
# 统一在用例内部导入。

# 用户给的真实测试图（学院「中秋放假 + 离返校登记」通知）对应的模型回复：
# 一图三类事 —— 假期是跨天日程（只记起始那天），登记与统计是带/不带截止的待办。
CAMPUS_NOTICE_REPLY = """
{"events":[
  {"title":"中秋节假期","kind":"EVENT","at": "2026-09-25T00:00:00+08:00",
   "description":"放假 3 天（9 月 25 日—9 月 27 日）","confidence":0.95},
  {"title":"中秋节假期离返校登记","kind":"TASK","at":"2026-09-24T23:59:00+08:00",
   "description":"钉钉→学工系统→节假日离返校→学生组；“离校不返家”需上传家长知情同意书"},
  {"title":"填写 2026-2027 秋学期中秋节返校情况","kind":"TASK",
   "description":"金山文档 https://www.kdocs.cn/l/cpk2A3hrWyCd"}
]}
"""


def test_parses_campus_notice_into_three_items() -> None:
    from app.services import vision

    items = vision._parse_items(CAMPUS_NOTICE_REPLY, "Asia/Shanghai")

    assert len(items) == 3

    holiday = items[0]
    assert holiday.kind == "EVENT"
    # 区间只记起始那一刻（日程只有一个时间点）
    assert holiday.at.isoformat() == "2026-09-25T00:00:00+08:00"

    sign_up = items[1]
    assert sign_up.kind == "TASK"
    assert sign_up.at.isoformat() == "2026-09-24T23:59:00+08:00"
    assert "家长知情同意书" in (sign_up.description or "")

    survey = items[2]
    assert survey.kind == "TASK"
    assert survey.at is None
    assert "http" not in survey.title
    assert "kdocs.cn" in (survey.description or "")


def test_tolerates_code_fence_prose_and_trailing_comma() -> None:
    from app.services import vision

    messy = """
    好的，识别结果如下：
    ```json
    {'events': [
      {'title': '季度技术评审会', 'at': '2026-09-26 15:00',},
    ],}
    ```
    需要我帮你创建吗？
    """
    items = vision._parse_items(messy, "Asia/Shanghai")

    assert len(items) == 1
    # 「2026-09-26 15:00」没有偏移量：按请求时区补上
    assert items[0].at.isoformat() == "2026-09-26T15:00:00+08:00"


def test_unconfigured_model_reports_unavailable() -> None:
    from app.errors import ApiError
    from app.errors import ErrorCode
    from app.services import vision

    assert vision.configured() is False
    with pytest.raises(ApiError) as failure:
        vision.recognize(b"\x89PNG", "image/png", "2026-09-25", "Asia/Shanghai")
    assert failure.value.code == ErrorCode.THIRD_PARTY_UNAVAILABLE
    assert "识别服务未配置" in failure.value.message


# ------------------------------------------------ OCR 文字 → 日程草稿（第二段，parse-text）


def test_parse_text_prompt_is_the_same_file_as_java() -> None:
    """两版用同一份抽取提示词：文件逐字节相同，否则线上跑的可能不是你以为的那版。"""
    from app.services import vision_text

    assert vision_text.template() == JAVA_VISION_PROMPT.read_text(encoding="utf-8")
    prompt = vision_text.template()
    # 三条口径是这轮产品的核心，缺一条都会让「中秋假期」这种叙述性内容混进草稿
    assert "要你做的事" in prompt
    assert "没写就留空" in prompt
    assert "不要猜时刻" in prompt


def test_parse_text_keeps_items_without_date() -> None:
    """缺日期是**合法结果**：照常返回这一条，让确认页补；不能因为它没日期就丢掉。"""
    from app.services import vision_text

    reply = """
    好的，识别结果如下：
    ```json
    {"items":[
      {"title":"离返校登记","at":"2026-09-24T00:00:00+08:00","timezone":"Asia/Shanghai"},
      {"title":"填写返校情况统计表","timezone":"Asia/Shanghai","description":"金山文档填写"}
    ]}
    ```
    """
    items = vision_text.parse_items(reply, "Asia/Shanghai")

    assert [item.title for item in items] == ["离返校登记", "填写返校情况统计表"]
    assert items[0].at == "2026-09-24T00:00:00+08:00"
    assert items[0].timezone == "Asia/Shanghai"
    assert items[1].at is None
    # 只产出日程：没有 kind / confidence
    assert "kind" not in items[0].to_dict()
    assert "confidence" not in items[0].to_dict()


def test_parse_text_tolerates_bad_reply() -> None:
    """解析不出来就回空列表，而不是抛异常把整条链路打断。"""
    from app.services import vision_text

    assert vision_text.parse_items("这张图里好像没有要做的事", "Asia/Shanghai") == []
    assert vision_text.parse_items('{"items":[{"timezone":"Asia/Shanghai"}]}', "Asia/Shanghai") == []
    assert vision_text.parse_items(None, "Asia/Shanghai") == []


def test_parse_text_unconfigured_reports_unavailable() -> None:
    from app.errors import ApiError, ErrorCode
    from app.services import vision_text

    assert vision_text.configured() is False
    with pytest.raises(ApiError) as failure:
        vision_text.parse("9 月 24 日前登记", "2026-09-30", "Asia/Shanghai")
    assert failure.value.code == ErrorCode.THIRD_PARTY_UNAVAILABLE
    assert "解析模型未配置" in failure.value.message


# ------------------------------------------------ 「周四被算成周五」的兜底（2026-11-03，P1）


def test_prompt_carries_the_weekday_table() -> None:
    """提示词必须给出「日期 + 星期」对照表：模型算不对今天星期几，就别让它推。"""
    from app.services import vision_text

    prompt = vision_text.template()
    assert "{{date_table}}" in prompt
    assert "日期只查表，不做心算" in prompt
    assert "{{today}}" in prompt


def test_date_guard_acceptance_cases_from_the_bug_report() -> None:
    """bug 报告 §5.4 的验收表：2026-11-03 那天是周二，「本周四」不能再落成 11-06（周五）。"""
    from datetime import date
    from zoneinfo import ZoneInfo

    from app.services import event_date_guard as guard

    zone = ZoneInfo("Asia/Shanghai")
    today = date(2026, 11, 3)
    assert guard.date_table(today, 3).splitlines() == [
        "- 2026-11-03 周二（今天）",
        "- 2026-11-04 周三（明天）",
        "- 2026-11-05 周四（后天）",
    ]

    cases = {
        "今天下午4点开会": ("2026-11-03T16:00:00+08:00", "2026-11-03"),
        "明天下午3点开会": ("2026-11-04T15:00:00+08:00", "2026-11-04"),
        "后天下午3点开会": ("2026-11-05T15:00:00+08:00", "2026-11-05"),
        "周四下午3点30开会": ("2026-11-06T15:30:00+08:00", "2026-11-05"),
        "本周四下午2点开会": ("2026-11-06T14:00:00+08:00", "2026-11-05"),
        "本周五下午2点开会": ("2026-11-07T14:00:00+08:00", "2026-11-06"),
        "本周一下午2点开会": ("2026-11-02T14:00:00+08:00", "2026-11-02"),
        "本周六下午2点开会": ("2026-11-07T14:00:00+08:00", "2026-11-07"),
        "本周日下午2点开会": ("2026-11-08T14:00:00+08:00", "2026-11-08"),
    }
    for text, (given, expected) in cases.items():
        fixed, _ = guard.guard_at(text, given, zone)
        assert fixed is not None
        assert fixed.startswith(expected), f"{text}: {given} -> {fixed}"


def test_date_guard_keeps_the_time_of_day() -> None:
    """只挪日期，不能顺手把 15:30 改成 00:00——纠星期不等于重新猜时刻。"""
    from zoneinfo import ZoneInfo

    from app.services import event_date_guard as guard

    fixed, note = guard.guard_at("周四下午3点30开会", "2026-11-06T15:30:00+08:00", ZoneInfo("Asia/Shanghai"))
    assert fixed == "2026-11-05T15:30:00+08:00"
    assert note and "周四" in note


def test_date_guard_does_not_guess_without_evidence() -> None:
    """没有「周 X」、没有日期、或者同时提到多个星期，都不动数据。"""
    from zoneinfo import ZoneInfo

    from app.services import event_date_guard as guard

    zone = ZoneInfo("Asia/Shanghai")
    assert guard.guard_at("11月6日下午3点开会", "2026-11-06T15:00:00+08:00", zone)[0] == "2026-11-06T15:00:00+08:00"
    assert guard.guard_at("本周四交材料", None, zone) == (None, None)
    fixed, note = guard.guard_at("周一交材料，周五开会", "2026-11-04T15:00:00+08:00", zone)
    assert fixed == "2026-11-04T15:00:00+08:00"
    assert note and "多个星期" in note
