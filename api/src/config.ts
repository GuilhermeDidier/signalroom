import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  // Optional explicit search_path (tests use an isolated schema). Hosted
  // Postgres normally sets it on the role, so this stays unset there.
  DATABASE_SEARCH_PATH: z.string().optional(),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // Namespace for BullMQ queues and rate-limit keys.
  REDIS_PREFIX: z.string().default('signalroom'),
  AI_URL: z.string().url().default('http://localhost:8000'),
  INTERNAL_TOKEN: z.string().min(8),
  JWT_SECRET: z.string().min(16),
  JWT_TTL: z.string().regex(/^\d+[smhd]$/, 'e.g. 12h, 30m, 7d').default('12h'),
  DEMO_MODE: bool,
  DEMO_PASSWORD: z.string().optional(),
  N8N_WEBHOOK_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),
  N8N_WEBHOOK_SECRET: z.string().optional(),
  CORS_ORIGINS: csv,
  WEB_URL: z.string().url().optional(),
  NEXT_PUBLIC_WEB_URL: z.string().url().optional(),
  WIDGET_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(20),
  WIDGET_IP_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(200),
  WIDGET_MAX_CHARS: z.coerce.number().int().positive().default(2000),
  AI_CHAT_TIMEOUT_MS: z.coerce.number().int().positive().default(90_000),
  AI_INGEST_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  INGEST_WORKER: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  INGEST_CONCURRENCY: z.coerce.number().int().positive().default(2),
  INGEST_BACKOFF_MS: z.coerce.number().int().positive().default(5_000),
  // Number of reverse-proxy hops to trust for the client IP (Render/Fly: 1). 0 = don't trust X-Forwarded-For.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  DOCUMENT_EVENTS_POLL_MS: z.coerce.number().int().positive().default(1_000),
});

export interface AppConfig {
  port: number;
  databaseUrl: string;
  databaseSearchPath?: string;
  databasePoolMax: number;
  redisUrl: string;
  redisPrefix: string;
  aiUrl: string;
  internalToken: string;
  jwtSecret: string;
  jwtTtl: string;
  demoMode: boolean;
  demoPassword?: string;
  n8nWebhookUrl?: string;
  n8nWebhookSecret?: string;
  corsOrigins: string[];
  webUrl: string;
  widget: { perVisitorPerHour: number; perIpPerHour: number; maxChars: number };
  aiChatTimeoutMs: number;
  aiIngestTimeoutMs: number;
  ingest: { workerEnabled: boolean; concurrency: number; backoffMs: number };
  documentEventsPollMs: number;
  trustProxy: number;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Parses and validates the environment once at boot; fails fast on bad config. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment:\n  ${issues.join('\n  ')}`);
  }
  const e = parsed.data;
  const webUrl = (e.WEB_URL ?? e.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    databaseSearchPath: e.DATABASE_SEARCH_PATH,
    databasePoolMax: e.DATABASE_POOL_MAX,
    redisUrl: e.REDIS_URL,
    redisPrefix: e.REDIS_PREFIX,
    aiUrl: e.AI_URL.replace(/\/$/, ''),
    internalToken: e.INTERNAL_TOKEN,
    jwtSecret: e.JWT_SECRET,
    jwtTtl: e.JWT_TTL,
    demoMode: e.DEMO_MODE,
    demoPassword: e.DEMO_PASSWORD,
    n8nWebhookUrl: e.N8N_WEBHOOK_URL,
    n8nWebhookSecret: e.N8N_WEBHOOK_SECRET,
    corsOrigins: e.CORS_ORIGINS.length ? e.CORS_ORIGINS : [webUrl],
    webUrl,
    widget: {
      perVisitorPerHour: e.WIDGET_RATE_LIMIT_PER_HOUR,
      perIpPerHour: e.WIDGET_IP_RATE_LIMIT_PER_HOUR,
      maxChars: e.WIDGET_MAX_CHARS,
    },
    aiChatTimeoutMs: e.AI_CHAT_TIMEOUT_MS,
    aiIngestTimeoutMs: e.AI_INGEST_TIMEOUT_MS,
    ingest: {
      workerEnabled: e.INGEST_WORKER,
      concurrency: e.INGEST_CONCURRENCY,
      backoffMs: e.INGEST_BACKOFF_MS,
    },
    documentEventsPollMs: e.DOCUMENT_EVENTS_POLL_MS,
    trustProxy: e.TRUST_PROXY,
  };
}
