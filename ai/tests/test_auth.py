import pytest
from fastapi.testclient import TestClient

from signalroom_ai.main import app

TOKEN = "test-internal-token"
client = TestClient(app)  # no lifespan: the embedding model is not loaded here


def test_health_is_public():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True, "embedding_model": "BAAI/bge-small-en-v1.5"}


@pytest.mark.parametrize(
    "path,body",
    [
        ("/redact", {"text": "x"}),
        ("/ingest", {"document_id": "00000000-0000-0000-0000-000000000000"}),
        ("/retrieve", {"tenant_id": "00000000-0000-0000-0000-000000000000", "query": "x"}),
        ("/chat", {"tenant_id": "00000000-0000-0000-0000-000000000000", "message": "hi"}),
    ],
)
@pytest.mark.parametrize("headers", [{}, {"X-Internal-Token": "wrong"}, {"X-Internal-Token": ""}])
def test_protected_endpoints_reject_missing_or_wrong_token(path, body, headers):
    assert client.post(path, json=body, headers=headers).status_code == 401


def test_redact_with_token():
    r = client.post(
        "/redact", json={"text": "write to a@example.com"}, headers={"X-Internal-Token": TOKEN}
    )
    assert r.status_code == 200
    assert r.json() == {
        "redacted": "write to [EMAIL_1]",
        "redactions": [{"type": "EMAIL", "count": 1}],
    }


def test_unset_server_token_rejects_everything(monkeypatch):
    from signalroom_ai import auth
    from signalroom_ai.config import get_settings

    monkeypatch.setattr(
        auth,
        "get_settings",
        lambda: get_settings().__class__(**{**get_settings().__dict__, "internal_token": ""}),
    )
    assert (
        client.post("/redact", json={"text": "x"}, headers={"X-Internal-Token": ""}).status_code
        == 401
    )
