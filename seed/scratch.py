"""Scratch-tenant helpers for tests, the retrieval eval and local smoke runs.

The ai service never creates tenants or documents (the api owns those writes), so
these helpers stand in for the api when exercising ai on its own.
"""

from __future__ import annotations

import json
import secrets
import sys
from pathlib import Path
from uuid import UUID

SEED = Path(__file__).resolve().parent
sys.path.insert(0, str(SEED.parent / "ai"))

from signalroom_ai.db import connection


def create_tenant(name: str, slug_prefix: str = "scratch") -> UUID:
    slug = f"{slug_prefix}-{secrets.token_hex(4)}"
    with connection() as conn:
        row = conn.execute(
            "INSERT INTO tenants (name, slug, widget_key) VALUES (%s, %s, %s) RETURNING id",
            (name, slug, f"pk_{slug_prefix}_{secrets.token_hex(8)}"),
        ).fetchone()
    return row["id"]


def add_document(
    tenant_id: UUID,
    title: str,
    source_type: str,
    content: bytes | None = None,
    mime: str | None = None,
    source_url: str | None = None,
) -> UUID:
    with connection() as conn:
        row = conn.execute(
            "INSERT INTO documents (tenant_id, title, source_type, source_url, mime, content)"
            " VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
            (tenant_id, title, source_type, source_url, mime, content),
        ).fetchone()
    return row["id"]


def delete_tenant(tenant_id: UUID) -> None:
    with connection() as conn:
        conn.execute("DELETE FROM llm_usage WHERE tenant_id = %s", (tenant_id,))
        conn.execute("DELETE FROM tenants WHERE id = %s", (tenant_id,))


def load_manifest(tenant_slug: str) -> list[dict]:
    manifest = json.loads((SEED / "files" / "manifest.json").read_text())
    return [m for m in manifest if m["tenant"] == tenant_slug]


def add_seed_documents(tenant_id: UUID, tenant_slug: str) -> dict[UUID, str]:
    """Insert the generated seed files of `tenant_slug`; returns {document_id: doc stem}."""
    out = {}
    for m in load_manifest(tenant_slug):
        data = (SEED / m["file"]).read_bytes()
        doc_id = add_document(tenant_id, m["title"], m["source_type"], data, m["mime"])
        out[doc_id] = m["doc"]
    return out


if __name__ == "__main__":
    # Usage: python seed/scratch.py <northwind|ledgerly>  -> prints tenant id + document ids
    slug = sys.argv[1]
    names = {
        "northwind": "Northwind Cycles (scratch)",
        "ledgerly": "Ledgerly (scratch)",
    }
    tid = create_tenant(names.get(slug, slug), slug_prefix=f"scratch-{slug}")
    docs = add_seed_documents(tid, slug)
    print(
        json.dumps(
            {"tenant_id": str(tid), "documents": {str(k): v for k, v in docs.items()}}
        )
    )
