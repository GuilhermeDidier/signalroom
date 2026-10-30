/**
 * Test environment. Isolation strategy:
 *   - Postgres: the real local database, but a dedicated schema `signalroom_test`
 *     (created from db/migrations by global-setup.ts through the real migration
 *     runner, via search_path). Each spec truncates the tables it needs in beforeAll.
 *   - Redis: logical DB 15 + its own key prefix, flushed by global-setup.ts.
 * Nothing here touches the dev data in `public` / Redis DB 0.
 */
process.env.DATABASE_URL ??= 'postgres://signalroom:signalroom@localhost:5434/signalroom';
process.env.DATABASE_SEARCH_PATH = 'signalroom_test,public';
process.env.REDIS_URL = 'redis://localhost:6379/15';
process.env.REDIS_PREFIX = 'srtest';
process.env.INTERNAL_TOKEN = 'test-internal-token';
process.env.JWT_SECRET = 'test-jwt-secret-0123456789';
process.env.DEMO_MODE = 'true';
process.env.DEMO_PASSWORD = 'demo-pass-123';
process.env.WEB_URL = 'http://web.test';
process.env.CORS_ORIGINS = 'http://web.test';
process.env.INGEST_BACKOFF_MS = '50';
process.env.DOCUMENT_EVENTS_POLL_MS = '100';
process.env.AI_URL = 'http://127.0.0.1:9'; // overridden per spec with a fake ai server
delete process.env.N8N_WEBHOOK_URL;
delete process.env.N8N_WEBHOOK_SECRET;
