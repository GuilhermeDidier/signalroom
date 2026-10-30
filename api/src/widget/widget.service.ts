import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { RateLimiter } from '../common/rate-limiter';
import { isOpen, openSse, SseParser, writeSse } from '../common/sse';
import { APP_CONFIG, AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { TenantRow, TenantsRepository } from '../tenants/tenants.repository';
import { AiDone, AiMeta, AiTool, PRIORITIES } from './ai-events';
import { NotifierService } from './notifier.service';

const HOUR_MS = 60 * 60 * 1000;
const HISTORY_LIMIT = 20;
const UNAVAILABLE = 'The assistant is temporarily unavailable. Please try again in a moment.';

export interface ChatInput {
  key: string;
  conversation_id?: string;
  visitor_id: string;
  message: string;
}

interface PreparedChat {
  tenant: TenantRow;
  conversationId: string;
  isNew: boolean;
  visitorId: string;
  message: string;
  history: { role: 'user' | 'assistant'; content: string }[];
}

interface Persisted {
  conversationId: string;
  messageId: string;
  ticket: { id: string; number: number } | null;
  notify: Parameters<NotifierService['notifyEscalation']>[0] | null;
}

@Injectable()
export class WidgetService {
  private readonly logger = new Logger(WidgetService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly tenants: TenantsRepository,
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly limiter: RateLimiter,
    private readonly notifier: NotifierService,
  ) {}

  async config(key: string) {
    const tenant = await this.tenantByKey(key);
    return {
      tenant_name: tenant.name,
      brand_color: tenant.brand_color,
      greeting: `Hi! I'm the ${tenant.name} assistant. Ask me anything. I'll answer from our help docs or bring in a human.`,
      // Lets /embed set CSP frame-ancestors so the widget only renders on the tenant's sites.
      allowed_origins: tenant.allowed_origins,
    };
  }

  /** Everything that can be refused with a plain HTTP status happens here, before the SSE stream opens. */
  async prepare(input: ChatInput, ip: string, res: Response): Promise<PreparedChat> {
    const message = input.message.trim();
    if (message.length > this.cfg.widget.maxChars) {
      throw new PayloadTooLargeException(`Message too long (max ${this.cfg.widget.maxChars} characters)`);
    }
    const tenant = await this.tenantByKey(input.key);

    // Per visitor (the contract's 20/hour) and per IP (visitor ids are client-generated and cheap to rotate).
    for (const [key, limit] of [
      [`widget:visitor:${tenant.id}:${input.visitor_id}`, this.cfg.widget.perVisitorPerHour],
      [`widget:ip:${tenant.id}:${ip}`, this.cfg.widget.perIpPerHour],
    ] as const) {
      const rl = await this.limiter.hit(key, limit, HOUR_MS);
      if (!rl.allowed) {
        res.setHeader('Retry-After', String(rl.retryAfterSeconds));
        throw new HttpException('Too many messages. Please wait a bit before sending more.', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    if (!input.conversation_id) {
      // The row is only created once the AI answered, so failed turns leave no empty conversations.
      return { tenant, conversationId: randomUUID(), isNew: true, visitorId: input.visitor_id, message, history: [] };
    }

    const { rows } = await this.db.query<{ visitor_id: string | null }>(
      'SELECT visitor_id FROM conversations WHERE id = $1 AND tenant_id = $2',
      [input.conversation_id, tenant.id],
    );
    // Another tenant's conversation, or another visitor's: indistinguishable from "doesn't exist".
    if (!rows[0] || rows[0].visitor_id !== input.visitor_id) throw new NotFoundException('Conversation not found');

    const history = await this.db.query<{ role: string; content: string }>(
      `SELECT role, content FROM (
         SELECT role, content, created_at, id FROM messages
          WHERE conversation_id = $1 AND tenant_id = $2
          ORDER BY created_at DESC, id DESC LIMIT ${HISTORY_LIMIT}
       ) recent ORDER BY created_at, id`,
      [input.conversation_id, tenant.id],
    );
    return {
      tenant,
      conversationId: input.conversation_id,
      isNew: false,
      visitorId: input.visitor_id,
      message,
      // Stored user text is already redacted. Human-agent replies are shown to the model as assistant turns.
      history: history.rows.map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content })),
    };
  }

  /**
   * Streams the ai answer to the visitor, relaying ai events unchanged, then
   * persists the turn and emits a final `saved` event. The raw visitor text is
   * only ever forwarded to ai; what we store is ai's `meta.redacted_message`.
   */
  async stream(chat: PreparedChat, res: Response): Promise<void> {
    openSse(res);
    const upstreamAbort = new AbortController();
    let clientGone = false;
    res.on('close', () => {
      if (!res.writableFinished) {
        clientGone = true;
        upstreamAbort.abort(); // stop paying for tokens nobody will read
      }
    });
    const timer = setTimeout(() => upstreamAbort.abort(), this.cfg.aiChatTimeoutMs);

    let meta: AiMeta | undefined;
    let done: AiDone | undefined;
    let failed = false; // transport/protocol failure on our side of the relay
    let aiErrorRelayed = false; // ai sent its own `error` event (already forwarded)
    const tools = new Set<string>();

    try {
      const upstream = await fetch(`${this.cfg.aiUrl}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'X-Internal-Token': this.cfg.internalToken,
        },
        body: JSON.stringify({
          tenant_id: chat.tenant.id,
          conversation_id: chat.conversationId,
          message: chat.message,
          history: chat.history,
          confidence_threshold: chat.tenant.confidence_threshold,
        }),
        signal: upstreamAbort.signal,
      });
      if (!upstream.ok || !upstream.body) throw new Error(`ai /chat responded ${upstream.status}`);

      const parser = new SseParser();
      const decoder = new TextDecoder();
      const handle = (event: string, data: string) => {
        writeSse(res, event, data); // relay unchanged
        try {
          const json: unknown = JSON.parse(data);
          if (event === 'meta') meta = AiMeta.parse(json);
          else if (event === 'done') done = AiDone.parse(json);
          else if (event === 'tool') tools.add(AiTool.parse(json).name);
          else if (event === 'error') aiErrorRelayed = true;
        } catch (err) {
          this.logger.warn(`unparseable ai '${event}' event: ${(err as Error).message}`);
          if (event === 'done' || event === 'meta') failed = true;
        }
      };
      for await (const chunk of upstream.body as AsyncIterable<Uint8Array>) {
        for (const ev of parser.push(decoder.decode(chunk, { stream: true }))) handle(ev.event, ev.data);
      }
      for (const ev of parser.end()) handle(ev.event, ev.data);
    } catch (err) {
      // A break AFTER `done` (e.g. the overall timeout firing while the socket
      // lingers) loses nothing: the visitor already has the full answer, so save it.
      if (!clientGone && !(meta && done)) {
        this.logger.warn(`ai chat failed: ${(err as Error).message}`);
        failed = true;
      }
    } finally {
      clearTimeout(timer);
    }

    if (clientGone && !done) return; // visitor left before an answer existed: nothing to save

    if (!meta || !done || failed || aiErrorRelayed) {
      // Nothing is persisted for a turn without a complete answer. If ai already
      // explained the failure its event was relayed; otherwise send a graceful one.
      if (!aiErrorRelayed) writeSse(res, 'error', { message: UNAVAILABLE });
      if (isOpen(res)) res.end();
      return;
    }

    let saved: Persisted;
    try {
      saved = await this.persist(chat, meta, done, tools);
    } catch (err) {
      this.logger.error(`could not persist chat turn: ${(err as Error).message}`);
      writeSse(res, 'error', { message: 'Your message could not be saved. Please try again.' });
      if (isOpen(res)) res.end();
      return;
    }

    writeSse(res, 'saved', { conversation_id: saved.conversationId, message_id: saved.messageId, ticket: saved.ticket });
    if (isOpen(res)) res.end();

    // After the visitor has their answer: webhook latency/failure never touches the chat.
    if (saved.notify) await this.notifier.notifyEscalation(saved.notify);
  }

  private async persist(chat: PreparedChat, meta: AiMeta, done: AiDone, tools: Set<string>): Promise<Persisted> {
    const tenantId = chat.tenant.id;
    const escalate = done.escalate;
    const intent = done.intent ?? meta.intent ?? null;
    const redactions = meta.redactions.filter((r) => r.count > 0);

    return this.db.tx(async (client) => {
      if (chat.isNew) {
        await client.query(
          `INSERT INTO conversations (id, tenant_id, channel, visitor_id, status) VALUES ($1, $2, 'widget', $3, $4)`,
          [chat.conversationId, tenantId, chat.visitorId, escalate ? 'escalated' : 'open'],
        );
      } else {
        // This UPDATE also row-locks the conversation until commit, which serializes
        // concurrent turns of one conversation: the second one waits here and then
        // sees the first one's ticket in the "open ticket" check below.
        await client.query(
          `UPDATE conversations SET last_message_at = now(),
                  status = CASE WHEN $3 THEN 'escalated' ELSE status END
            WHERE id = $1 AND tenant_id = $2`,
          [chat.conversationId, tenantId, escalate],
        );
      }

      // clock_timestamp(): distinct, ordered timestamps for the two rows of one transaction.
      const userMsg = await client.query<{ id: string }>(
        `INSERT INTO messages (conversation_id, tenant_id, role, content, redactions, intent, created_at)
         VALUES ($1, $2, 'user', $3, $4, $5, clock_timestamp()) RETURNING id`,
        [chat.conversationId, tenantId, meta.redacted_message, JSON.stringify(redactions), meta.intent ?? intent],
      );
      const aiMsg = await client.query<{ id: string }>(
        `INSERT INTO messages (conversation_id, tenant_id, role, content, intent, confidence, confidence_breakdown,
                               citations, escalated, created_at)
         VALUES ($1, $2, 'assistant', $3, $4, $5, $6, $7, $8, clock_timestamp()) RETURNING id`,
        [
          chat.conversationId,
          tenantId,
          done.answer,
          intent,
          done.confidence ?? null,
          done.confidence_breakdown ? JSON.stringify(done.confidence_breakdown) : null,
          JSON.stringify(done.citations),
          escalate,
        ],
      );

      if (redactions.length) {
        await this.audit.record(
          {
            tenantId,
            actorType: 'ai',
            action: 'pii.redacted',
            targetType: 'message',
            targetId: userMsg.rows[0].id,
            // Types and counts only: the values themselves are never stored anywhere.
            metadata: { conversation_id: chat.conversationId, redactions },
          },
          client,
        );
      }

      if (!escalate) {
        return { conversationId: chat.conversationId, messageId: aiMsg.rows[0].id, ticket: null, notify: null };
      }

      // One open ticket per conversation: a visitor repeating "human please" doesn't page ops twice.
      const open = await client.query<{ id: string; number: number }>(
        `SELECT id, number FROM tickets WHERE conversation_id = $1 AND status <> 'closed' ORDER BY created_at DESC LIMIT 1`,
        [chat.conversationId],
      );
      if (open.rows[0]) {
        await this.audit.record(
          {
            tenantId,
            actorType: 'ai',
            action: 'conversation.escalated',
            targetType: 'conversation',
            targetId: chat.conversationId,
            metadata: { reason: done.escalation_reason ?? null, intent, confidence: done.confidence ?? null, ticket_id: open.rows[0].id, reused_ticket: true },
          },
          client,
        );
        return { conversationId: chat.conversationId, messageId: aiMsg.rows[0].id, ticket: open.rows[0], notify: null };
      }

      const t = done.ticket ?? {};
      const priority = (PRIORITIES as readonly string[]).includes(t.priority ?? '')
        ? (t.priority as (typeof PRIORITIES)[number])
        : intent === 'complaint'
          ? 'high'
          : 'normal';
      const subject = (t.subject?.trim() || `Escalation: ${intent ?? 'support request'}`).slice(0, 200);
      const summary = (t.summary?.trim() || meta.redacted_message).slice(0, 4000);
      const source = tools.has('create_ticket') ? 'ai_tool' : 'escalation';
      const reason = done.escalation_reason ?? null;

      const ticket = await client.query<{ id: string; number: number; created_at: Date }>(
        `INSERT INTO tickets (tenant_id, conversation_id, subject, summary, priority, source, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, number, created_at`,
        [tenantId, chat.conversationId, subject, summary, priority, source, reason],
      );
      const tk = ticket.rows[0];
      await this.audit.record(
        {
          tenantId,
          actorType: 'ai',
          action: 'conversation.escalated',
          targetType: 'conversation',
          targetId: chat.conversationId,
          metadata: { reason, intent, confidence: done.confidence ?? null, ticket_id: tk.id },
        },
        client,
      );
      await this.audit.record(
        {
          tenantId,
          actorType: 'ai',
          action: 'ticket.created',
          targetType: 'ticket',
          targetId: tk.id,
          metadata: { number: tk.number, priority, source, subject },
        },
        client,
      );

      const web = this.cfg.webUrl;
      return {
        conversationId: chat.conversationId,
        messageId: aiMsg.rows[0].id,
        ticket: { id: tk.id, number: tk.number },
        notify: {
          tenant: { id: tenantId, slug: chat.tenant.slug, name: chat.tenant.name },
          ticket: {
            id: tk.id,
            number: tk.number,
            subject,
            summary,
            priority,
            source,
            reason,
            status: 'open',
            created_at: tk.created_at.toISOString(),
            dashboard_url: `${web}/app/${chat.tenant.slug}/tickets`,
          },
          conversation: {
            id: chat.conversationId,
            visitor_id: chat.visitorId,
            intent,
            confidence: done.confidence ?? null,
            last_user_message: meta.redacted_message,
            dashboard_url: `${web}/app/${chat.tenant.slug}/conversations/${chat.conversationId}`,
          },
        },
      };
    });
  }

  private async tenantByKey(key: string): Promise<TenantRow> {
    const tenant = /^pk_[A-Za-z0-9_-]{4,100}$/.test(key) ? await this.tenants.findByWidgetKey(key) : undefined;
    if (!tenant) throw new NotFoundException('Unknown widget key');
    return tenant;
  }
}
