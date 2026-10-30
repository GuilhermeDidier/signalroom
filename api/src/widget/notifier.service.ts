import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { APP_CONFIG, AppConfig } from '../config';
import { DbService } from '../db/db.service';
import { EscalationWebhookPayload, SIGNATURE_HEADER, signBody } from './escalation-webhook';

export type NotificationStatus = 'sent' | 'skipped' | 'failed';

/**
 * Notifies the ops channel (n8n → Slack/email) about a new escalation ticket.
 * Never throws: a failing webhook must not break the visitor's chat. The
 * outcome is stored on the ticket and in the audit log.
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async notifyEscalation(payload: Omit<EscalationWebhookPayload, 'delivery_id' | 'sent_at' | 'event' | 'version'>): Promise<NotificationStatus> {
    const ticketId = payload.ticket.id;
    let status: NotificationStatus;
    let detail: Record<string, unknown> = {};

    if (!this.cfg.n8nWebhookUrl || !this.cfg.n8nWebhookSecret) {
      status = 'skipped';
      detail = { reason: 'N8N_WEBHOOK_URL or N8N_WEBHOOK_SECRET not configured' };
    } else {
      const full: EscalationWebhookPayload = {
        event: 'ticket.escalated',
        version: 1,
        delivery_id: randomUUID(),
        sent_at: new Date().toISOString(),
        ...payload,
      };
      const body = JSON.stringify(full);
      try {
        const res = await fetch(this.cfg.n8nWebhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [SIGNATURE_HEADER]: signBody(body, this.cfg.n8nWebhookSecret),
            'X-Signalroom-Event': full.event,
            'X-Signalroom-Delivery': full.delivery_id,
          },
          body,
          signal: AbortSignal.timeout(5_000),
        });
        status = res.ok ? 'sent' : 'failed';
        detail = { http_status: res.status, delivery_id: full.delivery_id };
      } catch (err) {
        status = 'failed';
        detail = { error: (err as Error).message, delivery_id: full.delivery_id };
      }
    }

    try {
      await this.db.tx(async (client) => {
        await client.query('UPDATE tickets SET notification_status = $2, updated_at = now() WHERE id = $1', [ticketId, status]);
        await this.audit.record(
          { tenantId: payload.tenant.id, actorType: 'system', action: `notification.${status}`, targetType: 'ticket', targetId: ticketId, metadata: detail },
          client,
        );
      });
    } catch (err) {
      this.logger.error(`could not record notification outcome for ticket ${ticketId}: ${(err as Error).message}`);
    }
    if (status === 'failed') this.logger.warn(`escalation webhook failed for ticket ${ticketId}: ${JSON.stringify(detail)}`);
    return status;
  }
}
