/**
 * Demo seed: two fictional tenants, demo users, knowledge base, and (optionally)
 * realistic conversations, all produced through the real pipeline.
 *
 *   npx tsx scripts/seed.ts [--fresh] [--conversations] [--skip-docs] [--files-dir <dir>]
 *
 * Env: DATABASE_URL (+ optional DATABASE_SEARCH_PATH), DEMO_PASSWORD (required),
 *      API_URL (default http://localhost:4000; the api must be running for docs/conversations,
 *      and the ai service too), WEB_URL/NEXT_PUBLIC_WEB_URL (allowed widget origin),
 *      REDIS_URL + REDIS_PREFIX (only for --fresh, to clear rate-limit counters).
 *
 * Steps
 *  1. --fresh: TRUNCATE every app table in the current schema (TRUNCATE is the
 *     one documented way to reset audit_log, whose rows can't be UPDATEd/DELETEd).
 *  2. Upsert tenants, demo users (owner/admin/agent@<slug>.demo) and memberships. Idempotent.
 *  3. Upload every file in seed/files/<slug>/ via POST /tenants/:tid/documents as the
 *     tenant owner (real queue → worker → ai /ingest), skipping titles already
 *     present and not failed; then wait until all are indexed or failed.
 *  4. --conversations: replay scripts/seed-conversations.json through POST /widget/chat,
 *     so messages, confidences, tickets, redactions and analytics come from real runs.
 *     Skipped for a tenant that already has seed conversations (use --fresh to redo).
 *  5. Backdating: the replay happens "now", so each seeded conversation (and its
 *     messages and tickets) is shifted by one delta to a deterministic pseudo-random
 *     time in the last 14 days (business-ish hours, UTC). audit_log rows are
 *     append-only and keep their real timestamps; this is the only place the seed
 *     edits timestamps.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import IORedis from 'ioredis';
import { Client } from 'pg';
import { SseParser } from '../src/common/sse';

interface TenantSeed {
  slug: string;
  name: string;
  brand_color: string;
  users: { role: 'owner' | 'admin' | 'agent'; name: string }[];
}

// Fictional companies and people (labelled as such in the UI).
const TENANTS: TenantSeed[] = [
  {
    slug: 'northwind',
    name: 'Northwind Cycles',
    brand_color: '#0f7b6c',
    users: [
      { role: 'owner', name: 'Maya Lindqvist' },
      { role: 'admin', name: 'Tom Becker' },
      { role: 'agent', name: 'Priya Nair' },
    ],
  },
  {
    slug: 'ledgerly',
    name: 'Ledgerly',
    brand_color: '#5b4bdb',
    users: [
      { role: 'owner', name: 'Daniel Okafor' },
      { role: 'admin', name: 'Sofia Marques' },
      { role: 'agent', name: 'Lena Park' },
    ],
  },
];

/** Publishable widget keys are public by design (they ship in a <script> tag); fixed so the demo pages can embed them. */
const widgetKey = (slug: string) => `pk_demo_${slug}`;
const ALLOWED_EXT = new Set(['.pdf', '.docx', '.txt', '.md']);
const args = new Set(process.argv.slice(2));
const flag = (name: string) => args.has(name);
const argValue = (name: string) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const WEB_URL = (process.env.WEB_URL ?? process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const INDEX_TIMEOUT_MS = Number(process.env.SEED_INDEX_TIMEOUT_MS ?? 10 * 60_000);

function log(msg: string) {
  console.log(`[seed] ${msg}`);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const password = process.env.DEMO_PASSWORD;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  if (!password || password.length < 8) throw new Error('DEMO_PASSWORD (min 8 chars) is required');

  const searchPath = process.env.DATABASE_SEARCH_PATH;
  const db = new Client({ connectionString: databaseUrl, options: searchPath ? `-c search_path=${searchPath.replace(/\s+/g, '')}` : undefined });
  await db.connect();
  try {
    const schema = (await db.query<{ s: string }>('SELECT current_schema() AS s')).rows[0].s;
    log(`database schema: ${schema}; api: ${API_URL}`);

    if (flag('--fresh')) await fresh(db, schema);
    const tenants = await upsertTenantsAndUsers(db, password);

    if (!flag('--skip-docs')) {
      const filesDir = resolve(argValue('--files-dir') ?? join(__dirname, '..', '..', 'seed', 'files'));
      for (const t of TENANTS) await seedDocuments(t, tenants[t.slug], password, filesDir);
    }

    if (flag('--conversations')) {
      const script = JSON.parse(readFileSync(join(__dirname, 'seed-conversations.json'), 'utf8')) as Record<string, { kind: string; turns: string[] }[]>;
      for (const t of TENANTS) await seedConversations(db, t.slug, tenants[t.slug], script[t.slug] ?? []);
    }
    log('done');
  } finally {
    await db.end();
  }
}

async function fresh(db: Client, schema: string) {
  log(`--fresh: truncating all Signalroom tables in schema "${schema}"`);
  await db.query('TRUNCATE tenants, users, audit_log, llm_usage RESTART IDENTITY CASCADE');
  if (process.env.REDIS_URL) {
    const redis = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 });
    const prefix = process.env.REDIS_PREFIX ?? 'signalroom';
    const keys = await redis.keys(`${prefix}:rl:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  }
}

async function upsertTenantsAndUsers(db: Client, password: string): Promise<Record<string, string>> {
  const hash = await bcrypt.hash(password, 10);
  const origins = [...new Set([WEB_URL, 'http://localhost:3000'])];
  const ids: Record<string, string> = {};
  await db.query('BEGIN');
  try {
    for (const t of TENANTS) {
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO tenants (name, slug, widget_key, allowed_origins, brand_color)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, allowed_origins = EXCLUDED.allowed_origins,
                                          brand_color = EXCLUDED.brand_color
         RETURNING id`,
        [t.name, t.slug, widgetKey(t.slug), origins, t.brand_color],
      );
      ids[t.slug] = rows[0].id;
      for (const u of t.users) {
        const email = `${u.role}@${t.slug}.demo`;
        const user = await db.query<{ id: string }>(
          `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
           ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, password_hash = EXCLUDED.password_hash
           RETURNING id`,
          [email, u.name, hash],
        );
        await db.query(
          `INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = EXCLUDED.role`,
          [user.rows[0].id, rows[0].id, u.role],
        );
      }
      log(`tenant ${t.slug} (${rows[0].id}) key=${widgetKey(t.slug)} users=${t.users.map((u) => `${u.role}@${t.slug}.demo`).join(', ')}`);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
  return ids;
}

async function api<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('Authorization', `Bearer ${init.token}`);
  const res = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

interface DocRow {
  id: string;
  title: string;
  status: string;
  error: string | null;
  chunk_count: number;
}

/** Optional seed/files/manifest.json: [{tenant, title, file}] gives human titles. */
function manifestTitles(filesDir: string): Map<string, string> {
  const path = join(filesDir, 'manifest.json');
  const titles = new Map<string, string>();
  if (!existsSync(path)) return titles;
  const entries = JSON.parse(readFileSync(path, 'utf8')) as { tenant: string; title: string; file: string }[];
  for (const e of entries) titles.set(`${e.tenant}/${e.file.split('/').pop()}`, e.title);
  return titles;
}

async function seedDocuments(t: TenantSeed, tenantId: string, password: string, filesDir: string) {
  const dir = join(filesDir, t.slug);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => ALLOWED_EXT.has(extname(f).toLowerCase())).sort() : [];
  if (!files.length) {
    log(`${t.slug}: no files in ${dir}; skipping documents`);
    return;
  }
  const { token } = await api<{ token: string }>('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `owner@${t.slug}.demo`, password }),
  });
  const titles = manifestTitles(filesDir);
  const existing = await api<DocRow[]>(`/tenants/${tenantId}/documents`, { token });

  for (const file of files) {
    const title = titles.get(`${t.slug}/${file}`) ?? file.replace(/\.[^.]+$/, '');
    const prior = existing.find((d) => d.title === title);
    if (prior && prior.status !== 'failed') {
      log(`${t.slug}: "${title}" already ${prior.status}; skipping`);
      continue;
    }
    if (prior) {
      await api(`/tenants/${tenantId}/documents/${prior.id}/reindex`, { method: 'POST', token });
      log(`${t.slug}: re-queued failed "${title}"`);
      continue;
    }
    const form = new FormData();
    form.append('title', title);
    form.append('file', new Blob([readFileSync(join(dir, file))]), file);
    const doc = await api<DocRow>(`/tenants/${tenantId}/documents`, { method: 'POST', body: form, token });
    log(`${t.slug}: uploaded "${title}" → ${doc.status}`);
  }

  const started = Date.now();
  for (;;) {
    const docs = await api<DocRow[]>(`/tenants/${tenantId}/documents`, { token });
    const pending = docs.filter((d) => d.status !== 'indexed' && d.status !== 'failed');
    if (!pending.length) {
      for (const d of docs) log(`${t.slug}: ${d.status.padEnd(7)} ${d.title} (${d.chunk_count} chunks)${d.error ? ` ${d.error}` : ''}`);
      if (docs.some((d) => d.status === 'failed')) throw new Error(`${t.slug}: some documents failed to index`);
      return;
    }
    if (Date.now() - started > INDEX_TIMEOUT_MS) throw new Error(`${t.slug}: timed out waiting for ${pending.length} document(s) to index`);
    await new Promise((r) => setTimeout(r, 1500));
  }
}

interface ChatResult {
  conversationId?: string;
  ticket?: { id: string; number: number } | null;
  intent?: string;
  confidence?: number;
  error?: string;
}

async function widgetChat(key: string, visitorId: string, message: string, conversationId?: string): Promise<ChatResult> {
  const res = await fetch(`${API_URL}/widget/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, visitor_id: visitorId, message, conversation_id: conversationId }),
  });
  if (!res.ok || !res.body) return { error: `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}` };
  const parser = new SseParser();
  const decoder = new TextDecoder();
  const out: ChatResult = {};
  const handle = (event: string, data: string) => {
    const json = JSON.parse(data) as Record<string, unknown>;
    if (event === 'done') {
      out.intent = json.intent as string;
      out.confidence = json.confidence as number;
    } else if (event === 'saved') {
      out.conversationId = json.conversation_id as string;
      out.ticket = json.ticket as ChatResult['ticket'];
    } else if (event === 'error') out.error = json.message as string;
  };
  for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
    for (const ev of parser.push(decoder.decode(chunk, { stream: true }))) handle(ev.event, ev.data);
  }
  for (const ev of parser.end()) handle(ev.event, ev.data);
  return out;
}

async function seedConversations(db: Client, slug: string, tenantId: string, script: { kind: string; turns: string[] }[]) {
  const already = await db.query(`SELECT 1 FROM conversations WHERE tenant_id = $1 AND visitor_id LIKE 'seed-%' LIMIT 1`, [tenantId]);
  if (already.rowCount) {
    log(`${slug}: seed conversations already exist; use --fresh to replay`);
    return;
  }
  const runTag = randomBytes(3).toString('hex');
  const created: string[] = [];
  for (const [i, convo] of script.entries()) {
    const visitor = `seed-${runTag}-${i}`;
    let conversationId: string | undefined;
    for (const turn of convo.turns) {
      const r = await widgetChat(widgetKey(slug), visitor, turn, conversationId);
      if (r.error) {
        log(`${slug} #${i} [${convo.kind}] ERROR ${r.error}`);
        break;
      }
      conversationId = r.conversationId;
      log(
        `${slug} #${i} [${convo.kind}] intent=${r.intent} conf=${r.confidence?.toFixed(2)}${r.ticket ? ` ticket=#${r.ticket.number}` : ''}`,
      );
    }
    if (conversationId) created.push(conversationId);
  }
  await backdate(db, slug, created);
}

/** mulberry32: tiny deterministic PRNG so the same seed produces the same chart shape. */
function prng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

async function backdate(db: Client, slug: string, conversationIds: string[]) {
  const rand = prng([...slug].reduce((h, c) => h * 31 + c.charCodeAt(0), 7));
  const now = Date.now();
  await db.query('BEGIN');
  try {
    for (const id of conversationIds) {
      // Skew towards recent days (volume growing over the fortnight), 08:00–20:00 UTC.
      const daysAgo = Math.min(13, Math.floor(Math.pow(rand(), 1.4) * 14));
      const target = new Date(now - daysAgo * 86_400_000);
      target.setUTCHours(8 + Math.floor(rand() * 12), Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
      if (target.getTime() > now) target.setTime(now - Math.floor(rand() * 3_600_000));
      const { rows } = await db.query<{ created_at: Date }>('SELECT created_at FROM conversations WHERE id = $1', [id]);
      const deltaMs = target.getTime() - rows[0].created_at.getTime();
      const delta = `${deltaMs} milliseconds`;
      await db.query('UPDATE conversations SET created_at = created_at + $2::interval, last_message_at = last_message_at + $2::interval WHERE id = $1', [id, delta]);
      await db.query('UPDATE messages SET created_at = created_at + $2::interval WHERE conversation_id = $1', [id, delta]);
      await db.query('UPDATE tickets SET created_at = created_at + $2::interval, updated_at = updated_at + $2::interval WHERE conversation_id = $1', [id, delta]);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  }
  log(`${slug}: ${conversationIds.length} conversations spread over the last 14 days`);
}

main().catch((err: Error) => {
  console.error(`[seed] ${err.message}`);
  process.exit(1);
});
