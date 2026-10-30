"""Hybrid retrieval: pgvector cosine top-40 + Postgres FTS top-40, fused with RRF.

Every SQL statement filters on `tenant_id`; there is no code path that reads chunks
without it (tenant isolation is covered by tests).

Chunks of a `failed` document are never returned: a failed (re)index leaves the
previous chunks in place, but they no longer match the document, so citing them would
serve stale content. A (re)index in progress (queued/parsing/chunking/embedding) keeps
serving the previous chunks until ingest swaps them in one transaction.

Keyword side: `websearch_to_tsquery('english', q)` ranked by `ts_rank_cd` (mode
"all", the default). The websearch parser ANDs every term, so on its own it misses
most natural-language questions; inside the hybrid it acts as a high-precision
signal for exact terms (SKUs, error codes). Mode "any" turns the parsed query's
top-level ANDs into ORs. On the seed eval (seed/eval_retrieval.py) "any" is far
better as a keyword-only retriever but slightly worse inside the hybrid, so the
hybrid uses "all".
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Literal
from uuid import UUID

import numpy as np

from .db import connection
from .embeddings import embed_query

RRF_K = 60
CANDIDATES = 40
KeywordMode = Literal["any", "all"]


@dataclass
class Hit:
    chunk_id: int
    document_id: UUID
    document_title: str
    heading: str | None
    page: int | None
    content: str
    cosine: float | None = None
    vector_rank: int | None = None
    keyword_rank: int | None = None
    rrf_score: float = 0.0
    extra: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "chunk_id": self.chunk_id,
            "document_id": str(self.document_id),
            "document_title": self.document_title,
            "heading": self.heading,
            "page": self.page,
            "content": self.content,
            "vector_rank": self.vector_rank,
            "keyword_rank": self.keyword_rank,
            "rrf_score": round(self.rrf_score, 6),
            "cosine": None if self.cosine is None else round(self.cosine, 4),
        }


def rrf_fuse(rankings: Iterable[list[int]], k: int = RRF_K) -> list[tuple[int, float]]:
    """Reciprocal Rank Fusion: score(d) = sum over lists of 1 / (k + rank(d)), rank 1-based.

    Returns (id, score) sorted by score desc; ties keep first-seen order (stable).
    """
    scores: dict[int, float] = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking, start=1):
            scores[item] = scores.get(item, 0.0) + 1.0 / (k + rank)
    return sorted(scores.items(), key=lambda kv: kv[1], reverse=True)


_SELECT = (
    "SELECT c.id, c.document_id, d.title AS document_title, c.heading, c.page, c.content,"
    " 1 - (c.embedding <=> %(qvec)s) AS cosine"
    " FROM chunks c JOIN documents d ON d.id = c.document_id AND d.tenant_id = c.tenant_id"
    " AND d.status <> 'failed'"
)

_VECTOR_SQL = (
    _SELECT + " WHERE c.tenant_id = %(tenant)s ORDER BY c.embedding <=> %(qvec)s LIMIT %(limit)s"
)

_TSQUERY = {
    "all": "websearch_to_tsquery('english', %(text)s)",
    "any": "replace(websearch_to_tsquery('english', %(text)s)::text, ' & ', ' | ')::tsquery",
}


def _keyword_sql(mode: KeywordMode) -> str:
    return (
        _SELECT + f" CROSS JOIN (SELECT {_TSQUERY[mode]} AS q) AS t"
        " WHERE c.tenant_id = %(tenant)s AND t.q <> ''::tsquery AND c.tsv @@ t.q"
        " ORDER BY ts_rank_cd(c.tsv, t.q) DESC, c.id LIMIT %(limit)s"
    )


def _rows_to_hits(rows: list[dict]) -> list[Hit]:
    return [
        Hit(
            chunk_id=r["id"],
            document_id=r["document_id"],
            document_title=r["document_title"],
            heading=r["heading"],
            page=r["page"],
            content=r["content"],
            cosine=float(r["cosine"]),
        )
        for r in rows
    ]


def vector_search(tenant_id: UUID | str, qvec: np.ndarray, limit: int = CANDIDATES) -> list[Hit]:
    with connection() as conn, conn.transaction():
        # pgvector >= 0.8: keep scanning the HNSW graph until `limit` rows of THIS
        # tenant are found, instead of filtering a fixed ef_search candidate set.
        conn.execute("SET LOCAL hnsw.iterative_scan = 'relaxed_order'")
        conn.execute("SET LOCAL hnsw.ef_search = 100")
        rows = conn.execute(
            _VECTOR_SQL, {"tenant": tenant_id, "qvec": qvec, "limit": limit}
        ).fetchall()
    hits = _rows_to_hits(rows)
    # relaxed_order may return slightly out of order: rank by the exact distance.
    hits.sort(key=lambda h: h.cosine or 0.0, reverse=True)
    for rank, h in enumerate(hits, start=1):
        h.vector_rank = rank
    return hits


def keyword_search(
    tenant_id: UUID | str,
    text: str,
    qvec: np.ndarray,
    limit: int = CANDIDATES,
    mode: KeywordMode = "all",
) -> list[Hit]:
    with connection() as conn:
        rows = conn.execute(
            _keyword_sql(mode), {"tenant": tenant_id, "text": text, "qvec": qvec, "limit": limit}
        ).fetchall()
    hits = _rows_to_hits(rows)
    for rank, h in enumerate(hits, start=1):
        h.keyword_rank = rank
    return hits


def hybrid_search(
    tenant_id: UUID | str, query: str, k: int = 8, mode: KeywordMode = "all"
) -> list[Hit]:
    qvec = embed_query(query)
    vec_hits = vector_search(tenant_id, qvec)
    kw_hits = keyword_search(tenant_id, query, qvec, mode=mode)
    by_id: dict[int, Hit] = {h.chunk_id: h for h in vec_hits}
    for h in kw_hits:
        if h.chunk_id in by_id:
            by_id[h.chunk_id].keyword_rank = h.keyword_rank
        else:
            by_id[h.chunk_id] = h
    fused = rrf_fuse([[h.chunk_id for h in vec_hits], [h.chunk_id for h in kw_hits]])
    out = []
    for chunk_id, score in fused[:k]:
        hit = by_id[chunk_id]
        hit.rrf_score = score
        out.append(hit)
    return out
