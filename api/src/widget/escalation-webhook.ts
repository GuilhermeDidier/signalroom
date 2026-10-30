import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Payload POSTed to the n8n escalation webhook (N8N_WEBHOOK_URL).
 * Signed with HMAC-SHA256 over the exact raw body:
 *   X-Signalroom-Signature: sha256=<hex>
 * `sent_at` is inside the signed body so receivers can reject stale replays.
 * Contains only redacted conversation text: never raw visitor input.
 */
export interface EscalationWebhookPayload {
  event: 'ticket.escalated';
  version: 1;
  delivery_id: string;
  sent_at: string;
  tenant: { id: string; slug: string; name: string };
  ticket: {
    id: string;
    number: number;
    subject: string;
    summary: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    source: 'ai_tool' | 'escalation';
    reason: string | null;
    status: 'open';
    created_at: string;
    dashboard_url: string;
  };
  conversation: {
    id: string;
    visitor_id: string | null;
    intent: string | null;
    confidence: number | null;
    last_user_message: string;
    dashboard_url: string;
  };
}

export const SIGNATURE_HEADER = 'X-Signalroom-Signature';

export function signBody(rawBody: string, secret: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`;
}

/** Constant-time check, mirrored by the n8n Code node. */
export function verifySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(signBody(rawBody, secret));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
