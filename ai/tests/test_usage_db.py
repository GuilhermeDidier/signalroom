"""The daily LLM call cap must hold under concurrent turns."""

import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

from signalroom_ai import usage

pytestmark = pytest.mark.db


def test_reservations_never_exceed_the_cap_under_concurrency(scratch_tenant, monkeypatch):
    tid = scratch_tenant()
    cap = usage.calls_today() + 5
    monkeypatch.setattr(usage, "get_settings", lambda: SimpleNamespace(daily_llm_call_cap=cap))
    workers = 16
    barrier = threading.Barrier(workers)

    def worker(_):
        barrier.wait()  # all threads hit the check at the same moment
        return usage.reserve_call(tid)

    with ThreadPoolExecutor(workers) as pool:
        granted = list(pool.map(worker, range(workers)))

    assert sum(granted) == 5
    assert usage.calls_today() == cap
    assert usage.reserve_call(tid) is False


def test_record_tokens_does_not_count_another_call(scratch_tenant):
    tid = scratch_tenant()
    before = usage.calls_today()
    assert usage.reserve_call(tid) is True
    usage.record_tokens(tid, 120, 30)
    assert usage.calls_today() == before + 1
