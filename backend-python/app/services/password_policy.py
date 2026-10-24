"""账号密码的强度规则（与 Java 版 `PasswordPolicy` 逐条一致）。

8-20 位，不能包含空白。设置密码与忘记密码重置共用这一处，避免两条路径规则漂移。
"""

from __future__ import annotations

import re

from ..errors import ApiError, ErrorCode

MESSAGE = "密码需 8-20 位，且不能包含空格"

_WHITESPACE = re.compile(r"\s")


def validate_password(password: str | None) -> None:
    if password is None or not (8 <= len(password) <= 20):
        raise ApiError(ErrorCode.PARAM_INVALID, MESSAGE)
    if _WHITESPACE.search(password):
        raise ApiError(ErrorCode.PARAM_INVALID, MESSAGE)
