"""Document ingestion: parse -> chunk -> embed -> index, with status updates.

Status moves parsing -> chunking -> embedding -> indexed, or `failed` with `error`.
Idempotent: the document's chunks are replaced atomically in one transaction, under
a per-document advisory lock, so a re-index never leaves a half-written document.
"""

from __future__ import annotations

import logging
from uuid import UUID

from .chunking import chunk_sections, embedding_text
from .db import connection
from .embeddings import embed_passages
from .parsing import ParseError, Section, parse_docx, parse_html, parse_pdf, parse_text
from .safe_fetch import UnsafeURLError, fetch_url

log = logging.getLogger(__name__)


class DocumentNotFound(LookupError):
    pass


class BadDocument(ValueError):
    """Permanent input problem -> HTTP 422; retrying will not help."""


def _set_status(document_id: UUID, status: str, error: str | None = None) -> None:
    with connection() as conn:
        conn.execute(
            "UPDATE documents SET status = %s, error = %s, updated_at = now() WHERE id = %s",
            (status, error, document_id),
        )


def _sections_for(doc: dict) -> list[Section]:
    kind = doc["source_type"]
    content = bytes(doc["content"]) if doc["content"] is not None else None
    if kind == "url":
        if not doc["source_url"]:
            raise BadDocument("url document has no source_url")
        page = fetch_url(doc["source_url"])
        if page.content_type == "application/pdf" or page.body[:5] == b"%PDF-":
            return parse_pdf(page.body)
        if page.content_type in ("text/plain", "text/markdown"):
            return parse_text(page.body)
        return parse_html(page.body)[1]
    if content is None:
        raise BadDocument(f"{kind} document has no content")
    if kind == "pdf":
        return parse_pdf(content)
    if kind == "docx":
        return parse_docx(content)
    return parse_text(content)


def ingest_document(document_id: UUID) -> int:
    with connection() as conn:
        doc = conn.execute(
            "SELECT id, tenant_id, title, source_type, source_url, content FROM documents WHERE id = %s",
            (document_id,),
        ).fetchone()
    if doc is None:
        raise DocumentNotFound(str(document_id))

    try:
        _set_status(document_id, "parsing")
        sections = _sections_for(doc)
        del doc["content"]  # free the raw upload before embedding

        _set_status(document_id, "chunking")
        chunks = chunk_sections(sections)
        if not chunks:
            raise BadDocument("document produced no chunks")

        _set_status(document_id, "embedding")
        vectors = embed_passages([embedding_text(doc["title"], c) for c in chunks])

        with connection() as conn, conn.transaction():
            conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (str(document_id),))
            conn.execute("DELETE FROM chunks WHERE document_id = %s", (document_id,))
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO chunks (tenant_id, document_id, ordinal, heading, page, content, embedding)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s)",
                    [
                        (doc["tenant_id"], document_id, c.ordinal, c.heading, c.page, c.content, v)
                        for c, v in zip(chunks, vectors)
                    ],
                )
            conn.execute(
                "UPDATE documents SET status = 'indexed', error = NULL, chunk_count = %s,"
                " updated_at = now() WHERE id = %s",
                (len(chunks), document_id),
            )
        return len(chunks)
    except (ParseError, UnsafeURLError, BadDocument) as exc:
        _set_status(document_id, "failed", str(exc)[:500])
        raise BadDocument(str(exc)) from exc
    except Exception as exc:
        log.exception("ingest failed for %s", document_id)
        _set_status(document_id, "failed", f"transient error: {type(exc).__name__}")
        raise
