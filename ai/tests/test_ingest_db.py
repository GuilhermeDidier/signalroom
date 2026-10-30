import pytest
from scratch import add_document

from signalroom_ai.db import connection
from signalroom_ai.ingest import BadDocument, ingest_document

from .fixtures_docs import make_docx, make_pdf

pytestmark = pytest.mark.db


def _doc_row(doc_id):
    with connection() as conn:
        return conn.execute(
            "SELECT status, error, chunk_count FROM documents WHERE id = %s", (doc_id,)
        ).fetchone()


def _chunks(doc_id):
    with connection() as conn:
        return conn.execute(
            "SELECT ordinal, heading, page, content FROM chunks WHERE document_id = %s ORDER BY ordinal",
            (doc_id,),
        ).fetchall()


def test_ingest_pdf_keeps_pages_and_headings(scratch_tenant):
    tid = scratch_tenant()
    doc_id = add_document(tid, "Test PDF", "pdf", make_pdf(), "application/pdf")
    n = ingest_document(doc_id)
    row = _doc_row(doc_id)
    assert row["status"] == "indexed" and row["error"] is None and row["chunk_count"] == n >= 2
    chunks = _chunks(doc_id)
    by_page = {c["page"] for c in chunks}
    assert by_page == {1, 2}
    battery = [c for c in chunks if "zorbatron" in c["content"]]
    assert battery and all(
        c["page"] == 2 and c["heading"] == "Battery Storage Rules" for c in battery
    )
    assert any(c["heading"] == "Frame Warranty Terms" and c["page"] == 1 for c in chunks)


def test_ingest_docx_keeps_headings_and_tables(scratch_tenant):
    tid = scratch_tenant()
    doc_id = add_document(tid, "Test DOCX", "docx", make_docx())
    ingest_document(doc_id)
    chunks = _chunks(doc_id)
    rate = [c for c in chunks if "quuxplan" in c["content"]]
    assert rate and rate[0]["heading"] == "Rate Limits" and rate[0]["page"] is None
    assert any("Quux | 600 rpm" in c["content"] for c in chunks)
    assert any(c["heading"] == "Data Export" and "72 hours" in c["content"] for c in chunks)


def test_reingest_is_idempotent(scratch_tenant):
    tid = scratch_tenant()
    doc_id = add_document(tid, "Test PDF", "pdf", make_pdf())
    first = ingest_document(doc_id)
    second = ingest_document(doc_id)
    assert first == second == len(_chunks(doc_id))
    assert [c["ordinal"] for c in _chunks(doc_id)] == list(range(first))


def test_corrupt_file_marks_failed(scratch_tenant):
    tid = scratch_tenant()
    doc_id = add_document(tid, "Broken", "pdf", b"%PDF-1.4 this is not really a pdf")
    with pytest.raises(BadDocument):
        ingest_document(doc_id)
    row = _doc_row(doc_id)
    assert row["status"] == "failed" and row["error"]


def test_private_url_is_refused_at_ingest(scratch_tenant):
    tid = scratch_tenant()
    doc_id = add_document(
        tid, "Metadata", "url", source_url="http://169.254.169.254/latest/meta-data/"
    )
    with pytest.raises(BadDocument):
        ingest_document(doc_id)
    assert _doc_row(doc_id)["status"] == "failed"


def test_ingest_endpoint(scratch_tenant):
    from fastapi.testclient import TestClient

    from signalroom_ai.main import app

    tid = scratch_tenant()
    doc_id = add_document(tid, "Test DOCX", "docx", make_docx())
    client = TestClient(app)
    headers = {"X-Internal-Token": "test-internal-token"}
    r = client.post("/ingest", json={"document_id": str(doc_id)}, headers=headers)
    assert r.status_code == 200
    assert r.json() == {
        "document_id": str(doc_id),
        "status": "indexed",
        "chunk_count": len(_chunks(doc_id)),
    }
    bad = add_document(tid, "Bad", "docx", b"not a zip")
    assert (
        client.post("/ingest", json={"document_id": str(bad)}, headers=headers).status_code == 422
    )
    missing = "00000000-0000-0000-0000-000000000000"
    assert client.post("/ingest", json={"document_id": missing}, headers=headers).status_code == 404
