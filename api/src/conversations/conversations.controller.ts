import { Body, Controller, Get, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles, Tenant } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/types';
import { UuidPipe } from '../common/uuid.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';

const ListQuery = z.object({
  filter: z.enum(['all', 'low_confidence', 'escalated']).default('all'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const ReplyBody = z.object({ content: z.string().trim().min(1).max(4000) }).strict();

/**
 * "Low confidence" = at least one assistant answer below the tenant's current
 * confidence_threshold (same definition as analytics.low_confidence).
 */
@Controller('tenants/:tid/conversations')
export class ConversationsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'agent')
  async list(@Tenant() t: TenantContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>) {
    // Page first (index on tenant_id, last_message_at), then decorate only that page.
    const { rows } = await this.db.query(
      `WITH th AS (SELECT confidence_threshold FROM tenants WHERE id = $1),
       page AS (
         SELECT c.* FROM conversations c CROSS JOIN th
          WHERE c.tenant_id = $1
            AND ($2 = 'all'
                 OR ($2 = 'escalated' AND c.status = 'escalated')
                 OR ($2 = 'low_confidence' AND EXISTS (
                       SELECT 1 FROM messages m
                        WHERE m.conversation_id = c.id AND m.role = 'assistant'
                          AND m.confidence < th.confidence_threshold)))
          ORDER BY c.last_message_at DESC
          LIMIT $3 OFFSET $4
       )
       SELECT c.id, c.channel, c.visitor_id, c.status, c.created_at, c.last_message_at,
              s.message_count, s.min_confidence, s.has_low_confidence,
              last_msg.role AS last_message_role, left(last_msg.content, 160) AS last_message_preview,
              last_ai.intent AS last_intent, last_ai.confidence::float8 AS last_confidence,
              first_user.content AS first_question,
              tk.ticket
         FROM page c
         CROSS JOIN th
         CROSS JOIN LATERAL (
           SELECT count(*)::int AS message_count,
                  min(m.confidence)::float8 AS min_confidence,
                  coalesce(bool_or(m.role = 'assistant' AND m.confidence < th.confidence_threshold), false) AS has_low_confidence
             FROM messages m WHERE m.conversation_id = c.id
         ) s
         LEFT JOIN LATERAL (
           SELECT role, content FROM messages m WHERE m.conversation_id = c.id ORDER BY created_at DESC LIMIT 1
         ) last_msg ON true
         LEFT JOIN LATERAL (
           SELECT intent, confidence FROM messages m
            WHERE m.conversation_id = c.id AND m.role = 'assistant' ORDER BY created_at DESC LIMIT 1
         ) last_ai ON true
         LEFT JOIN LATERAL (
           SELECT left(content, 160) AS content FROM messages m
            WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY created_at LIMIT 1
         ) first_user ON true
         LEFT JOIN LATERAL (
           SELECT json_build_object('id', id, 'number', number, 'status', status, 'priority', priority) AS ticket
             FROM tickets WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
         ) tk ON true
        ORDER BY c.last_message_at DESC`,
      [t.tenantId, q.filter, q.limit, q.offset],
    );
    return rows;
  }

  @Get(':id')
  @Roles('owner', 'admin', 'agent')
  async detail(@Tenant() t: TenantContext, @Param('id', UuidPipe) id: string) {
    const { rows } = await this.db.query(
      `SELECT id, channel, visitor_id, status, created_at, last_message_at FROM conversations WHERE tenant_id = $1 AND id = $2`,
      [t.tenantId, id],
    );
    if (!rows[0]) throw new NotFoundException('Conversation not found');
    const [messages, tickets] = await Promise.all([
      this.db.query(
        `SELECT m.id, m.role, m.content, m.redactions, m.intent, m.confidence::float8 AS confidence,
                m.confidence_breakdown, m.citations, m.escalated, m.author_user_id, u.name AS author_name, m.created_at
           FROM messages m LEFT JOIN users u ON u.id = m.author_user_id
          WHERE m.tenant_id = $1 AND m.conversation_id = $2
          ORDER BY m.created_at, m.id`,
        [t.tenantId, id],
      ),
      this.db.query(
        `SELECT id, number, subject, summary, priority, status, source, reason, notification_status, assignee_user_id, created_at
           FROM tickets WHERE tenant_id = $1 AND conversation_id = $2 ORDER BY created_at`,
        [t.tenantId, id],
      ),
    ]);
    return { ...rows[0], messages: messages.rows, tickets: tickets.rows };
  }

  @Post(':id/reply')
  @Roles('owner', 'admin', 'agent')
  async reply(
    @Tenant() t: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(ReplyBody)) body: z.infer<typeof ReplyBody>,
  ) {
    return this.db.tx(async (client) => {
      const conv = await client.query(
        'UPDATE conversations SET last_message_at = now() WHERE tenant_id = $1 AND id = $2 RETURNING id',
        [t.tenantId, id],
      );
      if (conv.rowCount !== 1) throw new NotFoundException('Conversation not found');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO messages (conversation_id, tenant_id, role, content, author_user_id)
         VALUES ($1, $2, 'human_agent', $3, $4)
         RETURNING id, role, content, author_user_id, created_at`,
        [id, t.tenantId, body.content, user.id],
      );
      await this.audit.record(
        {
          tenantId: t.tenantId,
          actorType: 'user',
          actorId: user.id,
          action: 'human.replied',
          targetType: 'conversation',
          targetId: id,
          metadata: { message_id: rows[0].id, length: body.content.length },
        },
        client,
      );
      return rows[0];
    });
  }
}
