# Signalroom — service contract (internal, for builders)

Multi-tenant AI support copilot. Three services + infra, one Postgres.

```
web (Next.js, :3000) ──HTTP/SSE──▶ api (NestJS, :4000) ──HTTP/SSE──▶ ai (FastAPI, :8000)
        ▲ widget.js → iframe /embed       │  BullMQ (Redis :6379)            │
                                          │  worker: ingest jobs ───────────▶ POST /ingest
                                          │  escalation → n8n webhook (:5678)
                                          └──────────── Postgres + pgvector (:5434 local) ◀──┘
```

Schema: `db/migrations/001_init.sql` (single source of truth; do not fork it —
if you need a column, add `db/migrations/00N_*.sql` and say so in your report).

## Ownership of writes
- **ai** writes ONLY: `chunks`, `documents.status/error/chunk_count/updated_at`, `llm_usage`.
- **api** writes everything else (tenants, users, memberships, invites, documents rows,
  conversations, messages, tickets, audit_log). ai never creates tickets or messages.
- `audit_log` is append-only (DB trigger). Every sensitive action gets a row.

## Environment
| var | used by | notes |
|---|---|---|
| DATABASE_URL | ai, api | local: postgres://signalroom:signalroom@localhost:5434/signalroom |
| REDIS_URL | api | redis://localhost:6379 |
| AI_URL | api | http://localhost:8000 |
| INTERNAL_TOKEN | ai, api | shared secret, header `X-Internal-Token` on every api→ai call; ai rejects without it (401) |
| JWT_SECRET | api | |
| ANTHROPIC_API_KEY | ai | in repo-root `.env` (gitignored). NEVER print it. |
| LLM_MODEL | ai | default `claude-sonnet-5-5`. Use `claude-haiku-5-5` while developing/testing. NEVER any Opus. |
| ROUTER_MODEL | ai | default `claude-haiku-5-5` (intent routing) |
| DAILY_LLM_CALL_CAP | ai | default 400 (global, all tenants) → over cap: answer with a polite escalation, no LLM call |
| N8N_WEBHOOK_URL | api | optional; unset → ticket.notification_status='skipped' + audit row |
| N8N_WEBHOOK_SECRET | api | HMAC-SHA256 of raw body, header `X-Signalroom-Signature: sha256=<hex>` |
| NEXT_PUBLIC_API_URL | web | http://localhost:4000 |
| NEXT_PUBLIC_WEB_URL | web | http://localhost:3000 (widget.js uses it to build the iframe URL) |

## ai service (FastAPI, Python 3.12) — internal only
All endpoints except `/health` require `X-Internal-Token`.

- `GET /health` → `{"ok": true, "embedding_model": "BAAI/bge-small-en-v1.5"}`
- `POST /ingest` `{"document_id": uuid}` → runs synchronously, returns `{"document_id", "status": "indexed", "chunk_count": n}`.
  Reads `documents.content`/`source_url`, updates `documents.status` through
  `parsing → chunking → embedding → indexed` (or `failed` + `error`, HTTP 422 for bad input, 500 for transient).
  Idempotent: deletes the document's existing chunks before inserting.
  PDF (pypdf, keeps page numbers), DOCX (python-docx, keeps headings), URL (httpx + readability-style
  extraction, 2 MB cap, http/https only, block private/loopback IPs — SSRF), text.
  Chunking with LlamaIndex `SentenceSplitter` (~350 tokens, 50 overlap), heading carried per chunk.
  Embeddings: fastembed `BAAI/bge-small-en-v1.5` (384-d, normalized), loaded once at startup.
- `POST /retrieve` `{"tenant_id", "query", "k": 8}` → `{"results": [{"chunk_id","document_id","document_title","heading","page","content","vector_rank","keyword_rank","rrf_score","cosine"}]}`.
  Hybrid: pgvector cosine top-40 + Postgres FTS (`websearch_to_tsquery`, `ts_rank_cd`) top-40, fused with
  RRF (k=60). ALWAYS filtered by `tenant_id` in SQL (tenant isolation is tested).
- `POST /redact` `{"text"}` → `{"redacted", "redactions": [{"type": "EMAIL"|"PHONE"|"CARD"|"SSN"|"IBAN"|"IP", "count"}]}`.
  Card numbers validated with Luhn. Placeholders like `[EMAIL_1]`.
- `POST /chat` (SSE, `text/event-stream`) body:
  `{"tenant_id", "conversation_id", "message", "history": [{"role":"user"|"assistant","content"}], "confidence_threshold": 0.55}`
  Message is redacted FIRST; nothing unredacted reaches the LLM (history is already-redacted text from DB).
  Events (each `event: <name>\ndata: <json>\n\n`):
  - `meta` `{"intent", "intent_reason", "redacted_message", "redactions": [...]}`
  - `token` `{"text"}` — streamed answer text, with citation markers like `[1]`
  - `tool` `{"name": "create_ticket"|"handoff_to_human", "input": {...}}` (informational)
  - `done` `{"answer", "intent", "confidence", "confidence_breakdown": {...}, "citations": [{"n","chunk_id","document_id","document_title","heading","page","snippet"}], "escalate": bool, "escalation_reason": str|null, "ticket": {"subject","summary","priority"}|null, "usage": {"input_tokens","output_tokens"}}`
  - `error` `{"message"}`
  Intents: `how_to`, `billing`, `account`, `bug_report`, `complaint`, `human_request`, `out_of_scope`, `smalltalk`.
  Agent tools (Claude tool use): `search_knowledge_base(query)`, `create_ticket(subject, summary, priority)`,
  `handoff_to_human(reason)`. Answers must only use retrieved chunks and cite them.
  Confidence: deterministic, documented formula in code (retrieval strength + citation coverage +
  model's own answerable flag), unit-tested. `escalate = confidence < threshold OR intent in (human_request, complaint) OR handoff tool called`.
  When escalating, `ticket` must be filled (from the tool call or synthesized from the conversation).

## api service (NestJS, TypeScript) — public
Auth: `Authorization: Bearer <JWT>` (payload `{sub, email}`); tenant role read from `memberships` on
every request (not trusted from the token). Cross-tenant access → 404. Missing role → 403. No token → 401.
Every write route has a test proving an unauthorized request is refused.

- `POST /auth/login` `{email,password}` → `{token, user:{id,email,name}, memberships:[{tenant_id,tenant_name,tenant_slug,role}]}`
- `GET /me` → same shape minus token
- `POST /auth/demo` `{tenant_slug, role}` → login as the seeded demo user of that role (demo convenience; flagged by `DEMO_MODE=true`)
- `GET /tenants/:tid` → tenant (incl. widget_key, allowed_origins, brand_color, confidence_threshold)
- `PATCH /tenants/:tid/settings` (owner) `{confidence_threshold?, allowed_origins?, brand_color?}`
- `GET /tenants/:tid/members` (any) · `PATCH /tenants/:tid/members/:uid` (owner) `{role}`
- `POST /tenants/:tid/invites` (owner, admin) `{email, role}` → `{invite_url}` · `GET /tenants/:tid/invites`
- `GET /invites/:token` (public) · `POST /invites/:token/accept` (public) `{name, password}` → login payload
- `GET /tenants/:tid/documents` (any) → list with status
- `POST /tenants/:tid/documents` (owner, admin) multipart `file` (pdf/docx/txt/md, ≤10 MB) OR json `{url}` → 201, row `queued`, BullMQ job `ingest` (3 attempts, exponential backoff)
- `POST /tenants/:tid/documents/:id/reindex` (owner, admin) · `DELETE /tenants/:tid/documents/:id` (owner, admin)
- `GET /tenants/:tid/documents/events` (any, SSE over fetch with Bearer) → `event: documents` with the full list whenever any status changes (poll DB every 1s server-side is fine)
- `GET /tenants/:tid/conversations?filter=all|low_confidence|escalated` (any)
- `GET /tenants/:tid/conversations/:id` (any) → conversation + messages
- `POST /tenants/:tid/conversations/:id/reply` (any) `{content}` → human agent message (role `human_agent`)
- `GET /tenants/:tid/tickets` (any) · `PATCH /tenants/:tid/tickets/:id` (any) `{status?, assignee_user_id?}`
- `GET /tenants/:tid/analytics?days=14` (any) → `{conversations, ai_resolved, escalated, deflection_rate, low_confidence, avg_confidence, by_intent:[{intent,count}], daily:[{day,conversations,escalated}], top_unanswered:[{question, confidence}]}`
  deflection_rate = conversations NOT escalated / conversations (with ≥1 assistant answer).
- `GET /tenants/:tid/audit` (owner, admin)
- Widget (public, key-based):
  - `GET /widget/config?key=pk_...` → `{tenant_name, brand_color, greeting}`
  - `POST /widget/chat` `{key, conversation_id?, visitor_id, message}` → SSE: relays ai events unchanged,
    then a final `event: saved` `{conversation_id, message_id, ticket: {id, number}|null}`.
    Persists user message (redacted text from ai `meta`) + assistant message; on escalate creates ticket,
    sets conversation `escalated`, audit rows, fires n8n webhook (HMAC) → `notification_status`.
    Rate limit: 20 messages / visitor / hour, 2000 chars max.

Audit actions (minimum): `auth.login`, `invite.created`, `invite.accepted`, `member.role_changed`,
`document.uploaded`, `document.deleted`, `document.reindexed`, `settings.updated`, `pii.redacted`,
`conversation.escalated`, `ticket.created`, `ticket.updated`, `notification.sent|skipped|failed`, `human.replied`.

## web (Next.js App Router, TypeScript)
Pages: `/` (landing: what this is + "Try as a customer" + "Open the dashboard"), `/login` (demo role buttons),
`/app/[slug]/overview|conversations|conversations/[id]|documents|tickets|team|settings|audit`,
`/embed?key=` (widget UI inside the iframe), `/demo/[slug]` (fictional customer website with the script tag),
`/invite/[token]`, `public/widget.js` (vanilla, one `<script src=".../widget.js" data-key="pk_..." async>`).

Visual direction "Signal lamps": light ops console, cool blue-grey surfaces; every AI answer carries a
confidence lamp (green ≥ threshold+0.15, amber ≥ threshold, red < threshold); escalations light an alarm.
Dense tables, big numbers for deflection. Avoid: cream+serif+terracotta, near-black+acid-green,
1px-rule newspaper layout, identical card grids.

## Seed / demo data (all synthetic, fictional companies — label it as such in the UI)
Two tenants: **Northwind Cycles** (`northwind`, e-bike shop: warranty, returns, shipping, battery care,
servicing) and **Ledgerly** (`ledgerly`, fictional invoicing SaaS: billing, plans, SSO, data export, API limits).
Demo users per tenant: owner/admin/agent `@<slug>.demo`, password from env `DEMO_PASSWORD`.
