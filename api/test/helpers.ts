import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import { Server } from 'node:http';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { AppConfig, loadConfig } from '../src/config';
import { DbService } from '../src/db/db.service';
import { RedisService } from '../src/redis/redis.module';
import type { Role } from '../src/common/types';

export interface TestApp {
  app: INestApplication;
  http: Server;
  db: DbService;
  jwt: JwtService;
  cfg: AppConfig;
  close(): Promise<void>;
}

/** Boots the real AppModule with the same HTTP setup as main.ts. */
export async function createTestApp(env: Record<string, string | undefined> = {}): Promise<TestApp> {
  const cfg = loadConfig({ ...process.env, ...env });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.register(cfg)] }).compile();
  const app = moduleRef.createNestApplication({ bodyParser: false, logger: ['error'] });
  configureApp(app, cfg);
  await app.init();
  const db = app.get(DbService);
  if (cfg.databaseSearchPath && !env.DATABASE_URL) {
    const { rows } = await db.query<{ resolved: string | null }>(`SELECT (SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = to_regclass('tenants')) AS resolved`);
    if (rows[0].resolved !== 'signalroom_test') {
      await app.close();
      throw new Error(`test DB guard: tenants resolves to schema ${rows[0].resolved}, not signalroom_test`);
    }
  }
  return {
    app,
    http: app.getHttpServer() as Server,
    db: app.get(DbService),
    jwt: app.get(JwtService),
    cfg,
    close: () => app.close(),
  };
}

export const TEST_SCHEMA = 'signalroom_test';

/**
 * Hard guard: the app's connection must resolve `tenants` to the test schema.
 * Aborts the run instead of letting a misconfigured search_path reach public.
 */
export async function assertTestSchema(t: TestApp) {
  const { rows } = await t.db.query<{ schema: string; resolved: string | null }>(
    `SELECT current_schema() AS schema, (SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = to_regclass('tenants')) AS resolved`,
  );
  if (rows[0].schema !== TEST_SCHEMA || rows[0].resolved !== TEST_SCHEMA) {
    throw new Error(`test DB guard: current_schema=${rows[0].schema}, tenants resolves to ${rows[0].resolved}; refusing to run`);
  }
}

/** Truncation is the reset path for tests (TRUNCATE bypasses the audit row trigger by design). Schema-qualified on purpose. */
export async function resetData(t: TestApp) {
  await assertTestSchema(t);
  await t.db.query(
    `TRUNCATE ${TEST_SCHEMA}.tenants, ${TEST_SCHEMA}.users, ${TEST_SCHEMA}.audit_log, ${TEST_SCHEMA}.llm_usage RESTART IDENTITY CASCADE`,
  );
  const redis = t.app.get(RedisService).client;
  const keys = await redis.keys(`${t.cfg.redisPrefix}:rl:*`);
  if (keys.length) await redis.del(...keys);
}

export const PASSWORD = 'correct-horse-battery';
const HASH = bcrypt.hashSync(PASSWORD, 4);

export async function makeTenant(t: TestApp, slug: string) {
  const { rows } = await t.db.query<{ id: string; widget_key: string }>(
    `INSERT INTO tenants (name, slug, widget_key, allowed_origins) VALUES ($1, $2, $3, $4) RETURNING id, widget_key`,
    [`${slug} Inc`, slug, `pk_test_${slug}`, ['http://shop.test']],
  );
  return rows[0];
}

export interface TestUser {
  id: string;
  email: string;
  token: string;
  auth: { Authorization: string };
}

export async function makeUser(t: TestApp, email: string, memberships: [tenantId: string, role: Role][] = []): Promise<TestUser> {
  const { rows } = await t.db.query<{ id: string }>(
    'INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING id',
    [email, email.split('@')[0], HASH],
  );
  const id = rows[0].id;
  for (const [tenantId, role] of memberships) {
    await t.db.query('INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)', [id, tenantId, role]);
  }
  const token = t.jwt.sign({ sub: id, email });
  return { id, email, token, auth: { Authorization: `Bearer ${token}` } };
}

/** Two tenants; A has one user per role, B has its own owner (the "other tenant" attacker). */
export async function makeWorld(t: TestApp) {
  const a = await makeTenant(t, 'acme');
  const b = await makeTenant(t, 'globex');
  return {
    a,
    b,
    ownerA: await makeUser(t, 'owner@acme.test', [[a.id, 'owner']]),
    adminA: await makeUser(t, 'admin@acme.test', [[a.id, 'admin']]),
    agentA: await makeUser(t, 'agent@acme.test', [[a.id, 'agent']]),
    ownerB: await makeUser(t, 'owner@globex.test', [[b.id, 'owner']]),
  };
}

export async function waitFor<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 10_000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

export interface ParsedEvent {
  event: string;
  data: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- test assertions on arbitrary JSON
}

export function parseSse(text: string): ParsedEvent[] {
  return text
    .split('\n\n')
    .filter((b) => b.trim() && !b.startsWith(':'))
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)?.[1] ?? 'message';
      const data = block
        .split('\n')
        .filter((l) => l.startsWith('data: '))
        .map((l) => l.slice(6))
        .join('\n');
      return { event, data: JSON.parse(data) as unknown };
    });
}

/** supertest parser that keeps a text/event-stream body as a string. */
export function textParser(res: import('superagent').Response, cb: (err: Error | null, body: string) => void) {
  const stream = res as unknown as NodeJS.ReadableStream;
  let data = '';
  stream.on('data', (c: Buffer) => (data += c.toString()));
  stream.on('end', () => cb(null, data));
}

/** A pool on the test schema, independent of any app (fake services write through it). */
export function testPool(): Pool {
  return new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${process.env.DATABASE_SEARCH_PATH}`, max: 3 });
}
