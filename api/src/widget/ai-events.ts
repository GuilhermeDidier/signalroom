import { z } from 'zod';

/** Event payloads emitted by ai `POST /chat` (see CONTRACT.md). Parsed leniently: extra keys pass through. */
export const AiMeta = z.looseObject({
  intent: z.string().nullable().optional(),
  intent_reason: z.string().nullable().optional(),
  redacted_message: z.string(),
  redactions: z.array(z.looseObject({ type: z.string(), count: z.number() })).default([]),
});
export type AiMeta = z.infer<typeof AiMeta>;

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

export const AiDone = z.looseObject({
  answer: z.string(),
  intent: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  confidence_breakdown: z.record(z.string(), z.unknown()).nullable().optional(),
  citations: z.array(z.record(z.string(), z.unknown())).default([]),
  escalate: z.boolean().default(false),
  escalation_reason: z.string().nullable().optional(),
  ticket: z
    .looseObject({
      subject: z.string().optional(),
      summary: z.string().optional(),
      priority: z.string().optional(),
    })
    .nullable()
    .optional(),
});
export type AiDone = z.infer<typeof AiDone>;

export const AiTool = z.looseObject({ name: z.string() });
