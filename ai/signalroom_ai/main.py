"""FastAPI app for the internal ai service (see CONTRACT.md)."""

from __future__ import annotations

import asyncio
import json
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .agent.chat import run_turn
from .auth import require_internal_token
from .config import EMBEDDING_MODEL, get_settings
from .db import close_pool, get_pool
from .embeddings import embed_query, get_tokenizer
from .ingest import BadDocument, DocumentNotFound, ingest_document
from .redaction import redact
from .retrieval import hybrid_search

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("signalroom.ai")

# One ingest at a time keeps peak memory predictable on a 512 MB instance.
_ingest_lock = asyncio.Semaphore(1)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings = get_settings()
    if not settings.internal_token:
        log.warning("INTERNAL_TOKEN is not set: every protected endpoint will answer 401")
    get_pool()
    # Load the embedding model once, before the first request needs it.
    await asyncio.to_thread(lambda: (get_tokenizer(), embed_query("warm up")))
    log.info("ready: llm=%s router=%s", settings.llm_model, settings.router_model)
    yield
    close_pool()


app = FastAPI(title="Signalroom ai", version="0.1.0", lifespan=lifespan)
protected = [Depends(require_internal_token)]


class IngestRequest(BaseModel):
    document_id: UUID


class RetrieveRequest(BaseModel):
    tenant_id: UUID
    query: str = Field(min_length=1, max_length=2000)
    k: int = Field(default=8, ge=1, le=40)


class RedactRequest(BaseModel):
    text: str = Field(max_length=20000)


class Turn(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    tenant_id: UUID
    conversation_id: UUID | None = None
    message: str = Field(min_length=1, max_length=4000)
    history: list[Turn] = Field(default_factory=list)
    confidence_threshold: float = Field(default=0.55, ge=0, le=1)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "embedding_model": EMBEDDING_MODEL}


@app.post("/ingest", dependencies=protected)
async def ingest(req: IngestRequest) -> dict:
    async with _ingest_lock:
        try:
            n = await asyncio.to_thread(ingest_document, req.document_id)
        except DocumentNotFound:
            raise HTTPException(404, "document not found")
        except BadDocument as exc:
            raise HTTPException(422, str(exc))
        except Exception:  # noqa: BLE001 - already logged and marked failed by ingest_document
            raise HTTPException(500, "ingestion failed (transient); safe to retry")
    return {"document_id": str(req.document_id), "status": "indexed", "chunk_count": n}


@app.post("/retrieve", dependencies=protected)
async def retrieve(req: RetrieveRequest) -> dict:
    hits = await asyncio.to_thread(hybrid_search, req.tenant_id, req.query, req.k)
    return {"results": [h.to_dict() for h in hits]}


@app.post("/redact", dependencies=protected)
def redact_text(req: RedactRequest) -> dict:
    result = redact(req.text)
    return {"redacted": result.redacted, "redactions": result.summary()}


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, default=str)}\n\n"


@app.post("/chat", dependencies=protected)
async def chat(req: ChatRequest) -> StreamingResponse:
    async def events() -> AsyncIterator[str]:
        try:
            async for name, payload in run_turn(
                req.tenant_id,
                req.message,
                [t.model_dump() for t in req.history],
                req.confidence_threshold,
            ):
                yield _sse(name, payload)
        except LookupError:
            yield _sse("error", {"message": "unknown tenant"})
        except Exception:
            log.exception("chat turn failed")
            yield _sse("error", {"message": "internal error"})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
