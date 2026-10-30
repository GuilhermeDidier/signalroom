import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Patch, Query } from '@nestjs/common';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service';
import { CurrentUser, Roles, Tenant } from '../common/decorators';
import type { AuthUser, TenantContext } from '../common/types';
import { UuidPipe } from '../common/uuid.pipe';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';

const STATUSES = ['open', 'pending', 'closed'] as const;

const ListQuery = z.object({
  status: z.enum(STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

const PatchBody = z
  .object({
    status: z.enum(STATUSES).optional(),
    assignee_user_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((b) => b.status !== undefined || b.assignee_user_id !== undefined, 'nothing to update');

export interface TicketView {
  id: string;
  number: number;
  conversation_id: string | null;
  subject: string;
  summary: string;
  priority: string;
  status: string;
  source: string;
  reason: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  notification_status: string;
  created_at: Date;
  updated_at: Date;
}

const TICKET_VIEW = `t.id, t.number, t.conversation_id, t.subject, t.summary, t.priority, t.status, t.source,
  t.reason, t.assignee_user_id, a.name AS assignee_name, t.notification_status, t.created_at, t.updated_at`;

@Controller('tenants/:tid/tickets')
export class TicketsController {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('owner', 'admin', 'agent')
  async list(@Tenant() t: TenantContext, @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>): Promise<TicketView[]> {
    const { rows } = await this.db.query<TicketView>(
      `SELECT ${TICKET_VIEW}
         FROM tickets t LEFT JOIN users a ON a.id = t.assignee_user_id
        WHERE t.tenant_id = $1 AND ($2::text IS NULL OR t.status = $2)
        ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
                 CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
                 t.created_at DESC
        LIMIT $3 OFFSET $4`,
      [t.tenantId, q.status ?? null, q.limit, q.offset],
    );
    return rows;
  }

  @Patch(':id')
  @Roles('owner', 'admin', 'agent')
  async update(
    @Tenant() t: TenantContext,
    @CurrentUser() user: AuthUser,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(PatchBody)) body: z.infer<typeof PatchBody>,
  ): Promise<TicketView> {
    return this.db.tx(async (client) => {
      const { rows: current } = await client.query<{ status: string; assignee_user_id: string | null }>(
        'SELECT status, assignee_user_id FROM tickets WHERE tenant_id = $1 AND id = $2 FOR UPDATE',
        [t.tenantId, id],
      );
      if (!current[0]) throw new NotFoundException('Ticket not found');

      if (body.assignee_user_id) {
        const member = await client.query('SELECT 1 FROM memberships WHERE tenant_id = $1 AND user_id = $2', [
          t.tenantId,
          body.assignee_user_id,
        ]);
        if (member.rowCount !== 1) throw new BadRequestException('Assignee must be a member of this tenant');
      }

      const setAssignee = body.assignee_user_id !== undefined;
      await client.query(
        `UPDATE tickets SET
           status = COALESCE($3, status),
           assignee_user_id = CASE WHEN $4 THEN $5::uuid ELSE assignee_user_id END,
           updated_at = now()
         WHERE tenant_id = $1 AND id = $2`,
        [t.tenantId, id, body.status ?? null, setAssignee, body.assignee_user_id ?? null],
      );

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (body.status !== undefined) changes.status = { from: current[0].status, to: body.status };
      if (setAssignee) changes.assignee_user_id = { from: current[0].assignee_user_id, to: body.assignee_user_id };
      await this.audit.record(
        { tenantId: t.tenantId, actorType: 'user', actorId: user.id, action: 'ticket.updated', targetType: 'ticket', targetId: id, metadata: { changes } },
        client,
      );

      const { rows } = await client.query<TicketView>(
        `SELECT ${TICKET_VIEW} FROM tickets t LEFT JOIN users a ON a.id = t.assignee_user_id WHERE t.id = $1`,
        [id],
      );
      return rows[0];
    });
  }
}
