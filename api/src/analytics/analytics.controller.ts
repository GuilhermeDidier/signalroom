import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { Roles, Tenant } from '../common/decorators';
import type { TenantContext } from '../common/types';
import { ZodPipe } from '../common/zod.pipe';
import { DbService } from '../db/db.service';

const AnalyticsQuery = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) });

/**
 * Support analytics, computed entirely in SQL over the last `days` days (UTC).
 *
 * Definitions (the contract's formulas, made precise):
 *   window           conversations whose created_at is in the last `days` days
 *   conversations    conversations in the window with ≥1 assistant answer (the denominator)
 *   escalated        of those, conversations with ≥1 assistant message flagged `escalated`
 *                    (message-level, so a ticket later closed still counts as an escalation)
 *   ai_resolved      conversations − escalated
 *   deflection_rate  ai_resolved / conversations   (0 when there are no conversations)
 *   low_confidence   conversations with ≥1 assistant answer below the tenant's threshold
 *   avg_confidence   mean confidence of assistant answers created in the window (null if none)
 *   by_intent        assistant answers in the window grouped by intent
 *   daily            per UTC day (zero-filled): conversations started, and how many of them escalated
 *   top_unanswered   the 10 lowest-confidence answers below threshold, with the (redacted) user question
 */
@Controller('tenants/:tid/analytics')
export class AnalyticsController {
  constructor(private readonly db: DbService) {}

  @Get()
  @Roles('owner', 'admin', 'agent')
  async get(@Tenant() t: TenantContext, @Query(new ZodPipe(AnalyticsQuery)) q: z.infer<typeof AnalyticsQuery>) {
    const params = [t.tenantId, q.days];
    const since = `(date_trunc('day', now() AT TIME ZONE 'UTC') - make_interval(days => $2::int - 1)) AT TIME ZONE 'UTC'`;

    const [summary, byIntent, daily, unanswered] = await Promise.all([
      this.db.query<{
        conversations: number;
        escalated: number;
        low_confidence: number;
        avg_confidence: number | null;
      }>(
        `WITH th AS (SELECT confidence_threshold FROM tenants WHERE id = $1),
         conv AS (
           SELECT c.id,
                  bool_or(m.escalated) AS escalated,
                  bool_or(m.confidence < th.confidence_threshold) AS low
             FROM conversations c
             JOIN messages m ON m.conversation_id = c.id AND m.role = 'assistant'
             CROSS JOIN th
            WHERE c.tenant_id = $1 AND c.created_at >= ${since}
            GROUP BY c.id
         )
         SELECT count(*)::int AS conversations,
                count(*) FILTER (WHERE escalated)::int AS escalated,
                count(*) FILTER (WHERE low)::int AS low_confidence,
                (SELECT avg(confidence)::float8 FROM messages
                  WHERE tenant_id = $1 AND role = 'assistant' AND confidence IS NOT NULL
                    AND created_at >= ${since}) AS avg_confidence
           FROM conv`,
        params,
      ),
      this.db.query<{ intent: string; count: number }>(
        `SELECT coalesce(intent, 'unknown') AS intent, count(*)::int AS count
           FROM messages
          WHERE tenant_id = $1 AND role = 'assistant' AND created_at >= ${since}
          GROUP BY 1 ORDER BY count DESC, intent`,
        params,
      ),
      this.db.query<{ day: string; conversations: number; escalated: number }>(
        `WITH days AS (
           SELECT generate_series(${since}, now(), interval '1 day') AS day_start
         ),
         conv AS (
           SELECT c.id, c.created_at, bool_or(m.escalated) AS escalated
             FROM conversations c
             JOIN messages m ON m.conversation_id = c.id AND m.role = 'assistant'
            WHERE c.tenant_id = $1 AND c.created_at >= ${since}
            GROUP BY c.id
         )
         SELECT to_char(d.day_start AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
                count(conv.id)::int AS conversations,
                count(conv.id) FILTER (WHERE conv.escalated)::int AS escalated
           FROM days d
           LEFT JOIN conv ON conv.created_at >= d.day_start AND conv.created_at < d.day_start + interval '1 day'
          GROUP BY d.day_start ORDER BY d.day_start`,
        params,
      ),
      this.db.query<{ question: string; confidence: number }>(
        `SELECT q.content AS question, a.confidence::float8 AS confidence, a.intent, a.conversation_id
           FROM messages a
           JOIN tenants t ON t.id = a.tenant_id
           CROSS JOIN LATERAL (
             SELECT content FROM messages u
              WHERE u.conversation_id = a.conversation_id AND u.role = 'user' AND u.created_at <= a.created_at
              ORDER BY u.created_at DESC LIMIT 1
           ) q
          WHERE a.tenant_id = $1 AND a.role = 'assistant' AND a.created_at >= ${since}
            AND a.confidence < t.confidence_threshold
          ORDER BY a.confidence ASC, a.created_at DESC
          LIMIT 10`,
        params,
      ),
    ]);

    const s = summary.rows[0];
    const aiResolved = s.conversations - s.escalated;
    return {
      days: q.days,
      conversations: s.conversations,
      ai_resolved: aiResolved,
      escalated: s.escalated,
      deflection_rate: s.conversations ? round(aiResolved / s.conversations) : 0,
      low_confidence: s.low_confidence,
      avg_confidence: s.avg_confidence === null ? null : round(s.avg_confidence),
      by_intent: byIntent.rows,
      daily: daily.rows,
      top_unanswered: unanswered.rows,
    };
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000;
}
