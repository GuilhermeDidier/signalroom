# n8n escalation workflow

`escalation-workflow.json` turns a Signalroom escalation into a human notification:

```
Webhook (POST /webhook/signalroom-escalation, raw body)
  → Code: verify HMAC-SHA256 + reject stale deliveries
  → IF ticket.priority is high or urgent
       true  → Slack message to #support-escalations
       false → Email to the support queue
```

The api calls it once per **new** escalation ticket, after the visitor already
has their answer. Whatever happens here (n8n down, bad credentials, 500), the chat
is unaffected: the api stores the outcome on the ticket
(`notification_status = sent | failed | skipped`) and writes a
`notification.*` audit row.

## Import

1. Start n8n (`docker compose up n8n`, UI at http://localhost:5678).
2. n8n's Code node needs two environment settings for the signature check
   (add them to the n8n service environment):
   - `NODE_FUNCTION_ALLOW_BUILTIN=crypto`: lets the Code node `require('crypto')`
   - `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`: lets it read `$env.SIGNALROOM_WEBHOOK_SECRET`
   - `SIGNALROOM_WEBHOOK_SECRET=<same value as the api's N8N_WEBHOOK_SECRET>`
     (docker-compose already maps it from `N8N_WEBHOOK_SECRET`)
3. *Workflows → Import from file* → `escalation-workflow.json`
   (inside the container it is mounted at `/workflows/escalation-workflow.json`).
4. Replace the placeholder credentials on **Slack: page on-call** (Slack API
   credential + channel) and **Email: support queue** (SMTP credential, from/to).
5. Activate the workflow and point the api at the production webhook URL:
   ```
   N8N_WEBHOOK_URL=http://localhost:5678/webhook/signalroom-escalation
   N8N_WEBHOOK_SECRET=<shared secret>
   ```
   With `N8N_WEBHOOK_URL` unset, the api marks tickets `skipped` and moves on.

## Request

```
POST /webhook/signalroom-escalation
Content-Type: application/json
X-Signalroom-Signature: sha256=<hex HMAC-SHA256 of the raw body, key = N8N_WEBHOOK_SECRET>
X-Signalroom-Event: ticket.escalated
X-Signalroom-Delivery: <uuid>
```

The signature covers the exact bytes of the body, which is why the Webhook node
has **Raw Body** enabled and the Code node verifies against `$binary.data`, not the
re-serialised JSON. `sent_at` is inside the signed body; deliveries older than
5 minutes are rejected (replay guard).

## Payload

TypeScript source of truth: `api/src/widget/escalation-webhook.ts`
(`EscalationWebhookPayload`).

```json
{
  "event": "ticket.escalated",
  "version": 1,
  "delivery_id": "6c0f3c1e-…",
  "sent_at": "2026-10-30T12:00:00.000Z",
  "tenant": { "id": "uuid", "slug": "northwind", "name": "Northwind Cycles" },
  "ticket": {
    "id": "uuid",
    "number": 42,
    "subject": "Legal threat over refund",
    "summary": "Customer demands a full refund by Friday…",
    "priority": "urgent",
    "source": "ai_tool",
    "reason": "complaint",
    "status": "open",
    "created_at": "2026-10-30T12:00:00.000Z",
    "dashboard_url": "http://localhost:3000/app/northwind/tickets"
  },
  "conversation": {
    "id": "uuid",
    "visitor_id": "v_8f2…",
    "intent": "complaint",
    "confidence": 0.41,
    "last_user_message": "If I don't get a refund I'm calling my lawyer. Reach me at [EMAIL_1]",
    "dashboard_url": "http://localhost:3000/app/northwind/conversations/uuid"
  }
}
```

`priority` is one of `low | normal | high | urgent`; `source` is `ai_tool` (the
model called `create_ticket`) or `escalation` (low confidence, human request,
complaint, or handoff). Visitor text is always the **redacted** version: raw PII
never leaves the api.
