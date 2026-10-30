"""Chat paths that must work without any LLM call."""

import json

import pytest

pytestmark = pytest.mark.db


def _parse_sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


def test_over_daily_cap_escalates_without_llm(scratch_tenant, monkeypatch):
    from fastapi.testclient import TestClient

    from signalroom_ai.agent import chat as chat_mod
    from signalroom_ai.main import app

    def boom():
        raise AssertionError("LLM must not be called over the cap")

    monkeypatch.setattr(chat_mod, "get_client", boom)
    monkeypatch.setattr(chat_mod, "remaining_calls", lambda: 0)
    tid = scratch_tenant()
    r = TestClient(app).post(
        "/chat",
        json={
            "tenant_id": str(tid),
            "conversation_id": None,
            "message": "My card 4111 1111 1111 1111 was charged twice",
            "history": [],
        },
        headers={"X-Internal-Token": "test-internal-token"},
    )
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/event-stream")
    events = _parse_sse(r.text)
    assert [e for e, _ in events] == ["meta", "token", "done"]
    meta, done = events[0][1], events[-1][1]
    assert meta["redacted_message"] == "My card [CARD_1] was charged twice"
    assert meta["redactions"] == [{"type": "CARD", "count": 1}]
    assert done["escalate"] is True and done["escalation_reason"] == "daily_llm_cap_reached"
    assert done["ticket"]["subject"] and "4111" not in done["ticket"]["summary"]
    assert done["usage"] == {"input_tokens": 0, "output_tokens": 0}


def test_unknown_tenant_yields_error_event(db):
    from fastapi.testclient import TestClient

    from signalroom_ai.main import app

    r = TestClient(app).post(
        "/chat",
        json={"tenant_id": "00000000-0000-0000-0000-000000000000", "message": "hi"},
        headers={"X-Internal-Token": "test-internal-token"},
    )
    assert _parse_sse(r.text) == [("error", {"message": "unknown tenant"})]
