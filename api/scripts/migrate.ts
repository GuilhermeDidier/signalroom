/**
 * Applies db/migrations/*.sql in filename order, once each, tracked in
 * `schema_migrations`. Every migration runs in its own transaction.
 *
 * Schema-agnostic on purpose: no `public.` anywhere, so it works when the
 * DATABASE_URL role has search_path set to a dedicated schema (hosted
 * Supabase) or when DATABASE_SEARCH_PATH is given (tests).
 *
 * Baseline: the local docker-compose Postgres applies every migration file itself
 * through docker-entrypoint-initdb.d. If the CURRENT schema already has `tenants`
 * but no `schema_migrations`, all present files are recorded as applied instead
 * of being re-run (logged loudly).
 *
 * Usage: DATABASE_URL=... npx tsx scripts/migrate.ts [--dir ../db/migrations]
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Client, ClientBase } from 'pg';

const LOCK_KEY = 728_190_331; // arbitrary constant: serializes concurrent runners (e.g. 2 instances booting)

/** MIGRATIONS_DIR, else the nearest `db/migrations` walking up (works from scripts/ and dist/scripts/). */
export function defaultMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) return resolve(process.env.MIGRATIONS_DIR);
  for (let dir = __dirname; ; dir = dirname(dir)) {
    const candidate = join(dir, 'db', 'migrations');
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir) throw new Error('db/migrations not found; set MIGRATIONS_DIR');
  }
}

export async function runMigrations(client: ClientBase, dir: string, log: (m: string) => void = console.log): Promise<string[]> {
  const files = readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
  const applied: string[] = [];

  await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
  try {
    const { rows: existsRows } = await client.query<{ has_table: boolean; has_tenants: boolean }>(
      // Look in the CURRENT schema only. A bare to_regclass('tenants') would also
      // match a table in a fallback schema of the search_path (e.g. public) and
      // wrongly baseline a fresh schema.
      `SELECT to_regclass(format('%I.schema_migrations', current_schema())) IS NOT NULL AS has_table,
              to_regclass(format('%I.tenants', current_schema())) IS NOT NULL AS has_tenants`,
    );
    const { has_table, has_tenants } = existsRows[0];
    const { rows: schemaRows } = await client.query<{ schema: string | null }>('SELECT current_schema() AS schema');
    if (!schemaRows[0].schema) throw new Error('no current schema: the search_path names no existing schema');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    if (!has_table && has_tenants) {
      // docker-entrypoint-initdb.d runs EVERY file in db/migrations on a fresh volume,
      // so all files present now were applied by it.
      log(`[migrate] schema initialised outside the runner (docker initdb); baselining ${files.join(', ')}`);
      for (const f of files) {
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [f, checksum(join(dir, f))]);
      }
    }

    const { rows } = await client.query<{ filename: string; checksum: string }>('SELECT filename, checksum FROM schema_migrations');
    const done = new Map(rows.map((r) => [r.filename, r.checksum]));

    for (const file of files) {
      const sum = checksum(join(dir, file));
      const prev = done.get(file);
      if (prev !== undefined) {
        if (prev !== sum) throw new Error(`migration ${file} changed after it was applied (checksum mismatch); add a new migration instead`);
        continue;
      }
      log(`[migrate] applying ${file}`);
      await client.query('BEGIN');
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, sum]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
  }
  return applied;
}

function checksum(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const dirFlag = process.argv.indexOf('--dir');
  const dir = dirFlag !== -1 ? resolve(process.argv[dirFlag + 1]) : defaultMigrationsDir();
  const searchPath = process.env.DATABASE_SEARCH_PATH;
  const client = new Client({ connectionString: url, options: searchPath ? `-c search_path=${searchPath.replace(/\s+/g, '')}` : undefined });
  await client.connect();
  try {
    const { rows } = await client.query<{ schema: string }>('SELECT current_schema() AS schema');
    console.log(`[migrate] target schema: ${rows[0].schema}; migrations: ${dir}`);
    const applied = await runMigrations(client, dir);
    console.log(applied.length ? `[migrate] applied ${applied.length} migration(s)` : '[migrate] up to date');
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err: Error) => {
    console.error(`[migrate] ${err.message}`);
    process.exit(1);
  });
}
