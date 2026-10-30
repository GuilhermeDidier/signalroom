import { Injectable } from '@nestjs/common';
import { DbService, Queryable } from '../db/db.service';

export type AuditActorType = 'user' | 'ai' | 'system' | 'widget';

export type AuditAction =
  | 'auth.login'
  | 'invite.created'
  | 'invite.accepted'
  | 'member.role_changed'
  | 'document.uploaded'
  | 'document.deleted'
  | 'document.reindexed'
  | 'settings.updated'
  | 'pii.redacted'
  | 'conversation.escalated'
  | 'ticket.created'
  | 'ticket.updated'
  | 'notification.sent'
  | 'notification.skipped'
  | 'notification.failed'
  | 'human.replied';

export interface AuditEntry {
  tenantId: string | null;
  actorType: AuditActorType;
  actorId?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * The single write path into `audit_log`. The table is append-only at the DB
 * level (trigger), so this service only ever INSERTs. Pass a transaction
 * client to make the audit row commit/rollback with the action it describes.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: DbService) {}

  async record(entry: AuditEntry, q: Queryable = this.db): Promise<void> {
    await q.query(
      `INSERT INTO audit_log (tenant_id, actor_type, actor_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        entry.tenantId,
        entry.actorType,
        entry.actorId ?? null,
        entry.action,
        entry.targetType ?? null,
        entry.targetId ?? null,
        JSON.stringify(entry.metadata ?? {}),
      ],
    );
  }

  async list(tenantId: string, opts: { limit: number; action?: string; before?: number }) {
    const { rows } = await this.db.query(
      `SELECT a.id::text AS id, a.actor_type, a.actor_id, u.email AS actor_email, u.name AS actor_name,
              a.action, a.target_type, a.target_id, a.metadata, a.created_at
         FROM audit_log a
         LEFT JOIN users u ON a.actor_type = 'user' AND u.id::text = a.actor_id
        WHERE a.tenant_id = $1
          AND ($2::text IS NULL OR a.action = $2 OR a.action LIKE $2 || '.%')
          AND ($3::bigint IS NULL OR a.id < $3)
        ORDER BY a.id DESC
        LIMIT $4`,
      [tenantId, opts.action ?? null, opts.before ?? null, opts.limit],
    );
    return rows;
  }
}
