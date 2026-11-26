"""训练样本的单独同意、脱敏、保留期限与清理（任务 5）。

与 Java 版 `TrainingDataService` / `TrainingDataRedactor` 保持同一套行为：
默认关闭；只收手机端 OCR 文字（原图不出手机）；手机号、身份证号、姓名
不可逆替换后才入库；样本保留 90 天，关闭开关立即删除历史样本。
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone

from sqlalchemy import text

RETENTION_DAYS = 90
SOURCE_VISION_TEXT = "VISION_TEXT"

_PHONE = re.compile(r"(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d{9}(?!\d)")
_ID_CARD = re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")
_LABELED_NAME = re.compile(r"(姓名|联系人|收件人|参会人|负责人|班主任)[\s:：]+[\u4e00-\u9fa5·]{2,8}")
_ROLE_NAME = re.compile(
    r"([\u4e00-\u9fa5]{1,4})(老师|同学|经理|主任|书记|部长|医生|阿姨|叔叔|师傅)"
)

logger = logging.getLogger(__name__)


def redact(raw: str | None) -> str | None:
    """不可逆脱敏；与 Java 版规则一致。"""
    if raw is None or not raw.strip():
        return raw
    redacted = _PHONE.sub("[手机号]", raw)
    redacted = _ID_CARD.sub("[身份证号]", redacted)
    redacted = _LABELED_NAME.sub(r"\1：[姓名]", redacted)
    return _ROLE_NAME.sub(r"[姓名]\2", redacted)


def record_sample(identity_id: int, raw_text: str | None, parsed_items: list[dict]) -> bool:
    """写入一条脱敏样本；关闭开关、空结果或任何异常都安静返回 False。"""
    if not raw_text or not raw_text.strip() or not parsed_items:
        return False
    import json

    from ..db import SessionLocal

    try:
        redacted_text = (redact(raw_text) or "").strip()
        redacted_json = redact(json.dumps(parsed_items, ensure_ascii=False, separators=(",", ":")))
        if not redacted_text or redacted_json is None:
            return False
        with SessionLocal() as session:
            inserted = session.execute(
                text(
                    "INSERT INTO training_sample"
                    " (identity_id, source, redacted_text, parsed_json, sample_version, expires_at)"
                    " SELECT :identity_id, :source, :redacted_text, CAST(:parsed_json AS jsonb), 1,"
                    "        now() + (:retention_days * INTERVAL '1 day')"
                    " WHERE EXISTS (SELECT 1 FROM identity"
                    "               WHERE id = :identity_id AND training_data_opt_in = TRUE)"
                ),
                {
                    "identity_id": identity_id,
                    "source": SOURCE_VISION_TEXT,
                    "redacted_text": redacted_text,
                    "parsed_json": redacted_json,
                    "retention_days": RETENTION_DAYS,
                },
            ).rowcount
            session.commit()
        return inserted > 0
    except Exception:
        # 不记录原文或异常消息：采样失败不能把敏感文字带进日志，也不能影响解析结果
        logger.warning("训练样本写入失败（用户 %s），本次解析结果不受影响", identity_id)
        return False


def purge_expired() -> int:
    """删除到期样本；返回删除条数。"""
    from ..db import SessionLocal

    with SessionLocal() as session:
        deleted = session.execute(
            text("DELETE FROM training_sample WHERE expires_at <= now()")
        ).rowcount
        session.commit()
    return deleted


async def run_forever() -> None:
    """启动后清一次到期样本，之后每天清一次。由 lifespan 启动 / 取消。"""
    while True:
        try:
            deleted = await asyncio.to_thread(purge_expired)
            if deleted:
                logger.info("已删除 %s 条到期训练样本", deleted)
        except Exception:
            logger.exception("训练样本到期清理失败，将在下一轮重试")
        await asyncio.sleep(24 * 60 * 60)


def opted_in_view(identity) -> dict:
    return {
        "enabled": bool(identity.training_data_opt_in),
        "retentionDays": RETENTION_DAYS,
    }


def set_opted_in(identity, enabled: bool) -> dict:
    identity.training_data_opt_in = enabled
    identity.training_data_opted_in_at = datetime.now(timezone.utc) if enabled else None
    return opted_in_view(identity)
