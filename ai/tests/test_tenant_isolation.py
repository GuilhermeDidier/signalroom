import pytest
from scratch import add_document

from signalroom_ai.ingest import ingest_document
from signalroom_ai.retrieval import hybrid_search

pytestmark = pytest.mark.db

SHARED = (
    "# Refund policy\n\nRefunds for the glimmerwatt subscription are issued within 14 days. "
    "Contact billing to request a glimmerwatt refund."
)


def test_retrieval_never_crosses_tenants(scratch_tenant):
    a, b = scratch_tenant("Tenant A"), scratch_tenant("Tenant B")
    doc_a = add_document(a, "A refunds", "text", SHARED.encode())
    doc_b = add_document(
        b, "B refunds", "text", (SHARED + " Tenant B secret: zephyrcode 7781.").encode()
    )
    ingest_document(doc_a)
    ingest_document(doc_b)

    for query in ["glimmerwatt refund", "zephyrcode 7781", "How long do refunds take?"]:
        results = hybrid_search(a, query, k=40)
        assert results, query
        assert {r.document_id for r in results} == {doc_a}
        assert all("zephyrcode" not in r.content for r in results)

    results_b = hybrid_search(b, "zephyrcode", k=40)
    assert {r.document_id for r in results_b} == {doc_b}


def test_retrieve_endpoint_is_scoped(scratch_tenant):
    from fastapi.testclient import TestClient

    from signalroom_ai.main import app

    a, b = scratch_tenant("Tenant A"), scratch_tenant("Tenant B")
    ingest_document(
        add_document(
            b, "B only", "text", b"# Secrets\n\nThe vault code for tenant B is orangutan-42."
        )
    )
    r = TestClient(app).post(
        "/retrieve",
        json={"tenant_id": str(a), "query": "vault code orangutan", "k": 8},
        headers={"X-Internal-Token": "test-internal-token"},
    )
    assert r.status_code == 200 and r.json() == {"results": []}
