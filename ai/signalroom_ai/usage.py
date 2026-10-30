"""Global daily LLM call cap, backed by the `llm_usage` table.

The cap counts API calls across all tenants for the current UTC day. Every call is
reserved with `reserve_call` right before it is made: check and increment happen under
one transaction-scoped advisory lock, so concurrent turns can never overshoot the cap
(a plain "read the sum, then insert" lets every concurrent turn pass the check). A
reservation is not refunded when the call then fails, which errs on the side of the
budget. Token counts are added afterwards with `record_tokens`.
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


def reserve_call(tenant_id: UUID | str) -> bool:
    """Count one LLM call against today's cap; False (nothing counted) when over it."""
    with connection() as conn, conn.transaction():
        # The cap is global (a sum over every tenant's row), so a row lock is not
        # enough: serialize all reservations on one advisory lock instead.
        conn.execute("SELECT pg_advisory_xact_lock(hashtext('signalroom.llm_usage.cap'))")
        row = conn.execute(
            "SELECT coalesce(sum(calls), 0) AS n FROM llm_usage"
            " WHERE day = (now() AT TIME ZONE 'utc')::date"
        ).fetchone()
        if int(row["n"]) >= get_settings().daily_llm_call_cap:
            return False
        conn.execute(
            "INSERT INTO llm_usage (day, tenant_id, calls, input_tokens, output_tokens)"
            " VALUES ((now() AT TIME ZONE 'utc')::date, %s, 1, 0, 0)"
            " ON CONFLICT (day, tenant_id) DO UPDATE SET calls = llm_usage.calls + 1",
            (tenant_id,),
        )
    return True


def record_tokens(tenant_id: UUID | str, input_tokens: int, output_tokens: int) -> None:
    """Add the token counts of a call already counted by `reserve_call`."""
    with connection() as conn:
        conn.execute(
            "INSERT INTO llm_usage (day, tenant_id, calls, input_tokens, output_tokens)"
            " VALUES ((now() AT TIME ZONE 'utc')::date, %s, 0, %s, %s)"
            " ON CONFLICT (day, tenant_id) DO UPDATE SET"
            "  input_tokens = llm_usage.input_tokens + EXCLUDED.input_tokens,"
            "  output_tokens = llm_usage.output_tokens + EXCLUDED.output_tokens",
            (tenant_id, input_tokens, output_tokens),
        )
