"""Internal-token auth for api -> ai calls."""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException, status

from .config import get_settings


def require_internal_token(x_internal_token: str | None = Header(default=None)) -> None:
    expected = get_settings().internal_token
    # An unset INTERNAL_TOKEN must never mean "open": reject everything.
    if (
        not expected
        or x_internal_token is None
        or not hmac.compare_digest(x_internal_token.encode(), expected.encode())
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid internal token")
