# Signalroom `ai` service

Internal FastAPI service behind the NestJS `api`. It owns ingestion, hybrid
retrieval, PII redaction and the support agent. It writes only `chunks`,
`documents.status/error/chunk_count/updated_at` and `llm_usage` (see `CONTRACT.md`).

```
signalroom_ai/
  main.py           FastAPI app: /health /ingest /retrieve /redact /chat (SSE)
  auth.py           X-Internal-Token check (constant-time; unset token = reject all)
  config.py         env settings (refuses any Opus model id)
  db.py             psycopg 3 pool + pgvector
  ingest.py         parse -> chunk -> embed -> replace chunks, with status updates
  parsing.py        PDF (pages), DOCX (headings, tables), Markdown/text, HTML (readability)
  safe_fetch.py     SSRF-guarded URL fetch
  chunking.py       LlamaIndex SentenceSplitter, 350/50 tokens of the embedder's tokenizer
  embeddings.py     fastembed BAAI/bge-small-en-v1.5, loaded once
  retrieval.py      vector top-40 + FTS top-40, RRF (k=60), tenant-filtered SQL
  redaction.py      EMAIL / PHONE / CARD (Luhn) / SSN / IBAN (mod-97) / IP
  confidence.py     deterministic confidence formula
  usage.py          global daily LLM call cap (llm_usage)
  agent/
    router.py       intent routing (ROUTER_MODEL, structured output)
    chat.py         answering loop with tool use, streaming, escalation
    tools.py        tool schemas + numbered source registry
    prompts.py      system prompt
    stream_filter.py strips the trailing <answerable> tag from the token stream
```

## Run locally

```bash
docker compose up -d postgres            # from the repo root
cd ai
uv venv .venv && uv sync                 # Python 3.12
INTERNAL_TOKEN=dev-token LLM_MODEL=claude-haiku-5-5 \
  .venv/bin/uvicorn signalroom_ai.main:app --port 8000
```

`ANTHROPIC_API_KEY` is read from the repo-root `.env` (or the environment).
Other variables: `DATABASE_URL`, `INTERNAL_TOKEN`, `LLM_MODEL` (default
`claude-sonnet-5-5`), `ROUTER_MODEL` (default `claude-haiku-5-5`),
`DAILY_LLM_CALL_CAP` (default 400), `EMBED_THREADS` (default 1).

Docker: `docker build -t signalroom-ai ai/` — the embedding model is baked into the
image; the server listens on `$PORT` (default 8000).

## Tests

```bash
cd ai && .venv/bin/python -m pytest          # offline: no API calls
.venv/bin/python -m pytest -m llm            # the one real Claude round-trip
```

Database tests skip themselves when Postgres is not reachable. To keep them away from
other test suites that reset `public`, point them at their own schema (create it once
with `db/migrations/001_init.sql` under `SET search_path = ai_dev, public`):

```bash
DATABASE_URL='postgresql://signalroom:signalroom@localhost:5434/signalroom?options=-csearch_path%3Dai_dev,public' \
  .venv/bin/python -m pytest
```

## Seed data and retrieval eval

```bash
ai/.venv/bin/python seed/build_files.py      # seed/corpus/*.md -> seed/files/*.pdf|docx + manifest.json
ai/.venv/bin/python seed/eval_retrieval.py   # recall@5 / MRR@10 per retrieval method
ai/.venv/bin/python seed/scratch.py northwind  # scratch tenant + documents rows, prints ids
```

## Retrieval

`/retrieve` and the agent's `search_knowledge_base` tool run the same hybrid search:

1. **Vector**: `ORDER BY embedding <=> query LIMIT 40`, HNSW with
   `hnsw.iterative_scan = relaxed_order` so a tenant filter never starves the result set.
   Queries get the BGE query instruction prefix; passages are embedded as
   `"<title> — <heading>\n<content>"`.
2. **Keyword**: `websearch_to_tsquery('english', q)` ranked with `ts_rank_cd`. It ANDs
   every term, so alone it misses most natural-language questions, but inside the
   hybrid it adds precise matches on exact terms. An OR variant (`mode="any"`) exists
   and is measured by the eval; it did not beat the AND version inside the hybrid.
3. **RRF**: `score = Σ 1 / (60 + rank)` over the two lists; top `k` returned with
   both ranks and the cosine.

Every statement filters `chunks.tenant_id` (and joins documents on the same tenant).

## Confidence

```
confidence = 0.45 * R + 0.35 * C + 0.20 * A
```

- **R, retrieval strength**: best cosine among the chunks the answer cites (or the
  best retrieved chunk when nothing is cited), mapped linearly from [0.60, 0.80] to
  [0, 1] (calibrated on the seed eval: in-scope top-1 cosine mean 0.73,
  out-of-scope mean 0.585).
- **C, citation coverage**: share of claim sentences (4+ words, not a lead-in ending
  with `:`) that carry a valid `[n]` marker.
- **A, answerable flag**: the model ends each reply with
  `<answerable>yes|partial|no</answerable>` (stripped from the stream):
  yes = 1, partial = 0.5, no = 0, missing = 0.5.
- Caps: `A = no` → at most 0.30; no valid citation → at most 0.35.
- Smalltalk / out-of-scope replies that neither searched nor cited get a fixed 0.80 /
  0.60 (R and C do not apply).

The full definition lives in `signalroom_ai/confidence.py` and is unit-tested in
`tests/test_confidence.py`.

## Escalation

`escalate` is true when any of these hold, and `escalation_reason` lists them:
handoff tool called, intent `human_request`/`complaint`, `create_ticket` called,
confidence below the tenant threshold, empty answer, or the daily LLM cap is reached
(then no LLM call is made at all). When escalating, `ticket` is the `create_ticket`
input or is synthesized from the redacted message and the reply.

## Privacy

The user message is redacted before routing and answering; only the redacted text
reaches the LLM and the `meta` event. History is expected to be already-redacted text
from the database.
