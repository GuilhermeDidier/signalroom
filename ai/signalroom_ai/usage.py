"""Global daily LLM call cap, backed by the `llm_usage` table.

The cap counts API calls across all tenants for the current UTC day. It is checked
before a chat turn starts (no LLM call at all when over cap) and every call made
is recorded with its token counts.
"""

from __future__ import annotations

from uuid import UUID

from .config import get_settings
from .db import connection


def calls_today() -> int:
    with connection() as conn:
        row = conn.execute(
            "SELECT coalesce(sum(calls), 0) AS n FROM llm_usage"
            " WHERE day = (now() AT TIME ZONE 'utc')::date"
        ).fetchone()
    return int(row["n"])


def remaining_calls() -> int:
    return max(0, get_settings().daily_llm_call_cap - calls_today())


def record_call(tenant_id: UUID | str, input_tokens: int, output_tokens: int) -> None:
    with connection() as conn:
        conn.execute(
            "INSERT INTO llm_usage (day, tenant_id, calls, input_tokens, output_tokens)"
            " VALUES ((now() AT TIME ZONE 'utc')::date, %s, 1, %s, %s)"
            " ON CONFLICT (day, tenant_id) DO UPDATE SET"
            "  calls = llm_usage.calls + 1,"
            "  input_tokens = llm_usage.input_tokens + EXCLUDED.input_tokens,"
            "  output_tokens = llm_usage.output_tokens + EXCLUDED.output_tokens",
            (tenant_id, input_tokens, output_tokens),
        )
