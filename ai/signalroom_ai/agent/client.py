"""Shared Anthropic client (async)."""

from __future__ import annotations

from functools import lru_cache

import anthropic

from ..config import get_settings


class LLMUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=1)
def get_client() -> anthropic.AsyncAnthropic:
    key = get_settings().anthropic_api_key
    if not key:
        raise LLMUnavailable("ANTHROPIC_API_KEY is not set")
    return anthropic.AsyncAnthropic(api_key=key, max_retries=2, timeout=60.0)
