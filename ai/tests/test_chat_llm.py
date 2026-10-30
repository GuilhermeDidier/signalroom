"""One real round-trip through Claude. Costs a fraction of a cent with Haiku.

Run with:  pytest -m llm
"""

import pytest
from scratch import add_document

from signalroom_ai.ingest import ingest_document

from .fixtures_docs import make_docx
from .test_chat_offline import _parse_sse

pytestmark = [pytest.mark.llm, pytest.mark.db]


def test_grounded_answer_with_citation(scratch_tenant):
    from fastapi.testclient import TestClient

    from signalroom_ai.main import app

    tid = scratch_tenant("Quux Ledger (test)")
    ingest_document(add_document(tid, "Ledger Test Guide", "docx", make_docx()))
    r = TestClient(app).post(
        "/chat",
        json={
            "tenant_id": str(tid),
            "message": "How long until my CSV export link expires? I'm bob@example.com",
            "history": [],
            "confidence_threshold": 0.55,
        },
        headers={"X-Internal-Token": "test-internal-token"},
    )
    events = _parse_sse(r.text)
    names = [e for e, _ in events]
    assert names[0] == "meta" and names[-1] == "done", names
    assert "[EMAIL_1]" in events[0][1]["redacted_message"]
    done = events[-1][1]
    assert "72" in done["answer"]
    assert done["citations"] and done["citations"][0]["document_title"] == "Ledger Test Guide"
    assert "<answerable>" not in done["answer"]
    assert "".join(d["text"] for e, d in events if e == "token").strip() == done["answer"]
