import IORedis from 'ioredis';
import { Client } from 'pg';
import { defaultMigrationsDir, runMigrations } from '../scripts/migrate';

export const TEST_SCHEMA = 'signalroom_test';

// search_path stays `signalroom_test,public` only because the pgvector/pgcrypto
// types live in public (an extension installs into one schema per database).
// Every table resolves in signalroom_test: global setup asserts the tables exist
// there and helpers.assertTestSchema() re-checks before any destructive statement.

export default async function globalSetup() {
  const url = process.env.DATABASE_URL ?? 'postgres://signalroom:signalroom@localhost:5434/signalroom';
  const admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
  await admin.end();

  // Same runner as production, exercised against a non-public schema.
  const client = new Client({ connectionString: url, options: `-c search_path=${TEST_SCHEMA},public` });
  await client.connect();
  const { rows } = await client.query<{ schema: string }>('SELECT current_schema() AS schema');
  if (rows[0].schema !== TEST_SCHEMA) throw new Error(`refusing to migrate: current_schema() is ${rows[0].schema}`);
  await runMigrations(client, defaultMigrationsDir(), () => undefined);
  // The tables must physically exist in the test schema, or queries would fall through to public.
  const check = await client.query<{ ok: boolean }>(`SELECT to_regclass('${TEST_SCHEMA}.tenants') IS NOT NULL AS ok`);
  await client.end();
  if (!check.rows[0].ok) throw new Error(`migrations did not create tables in ${TEST_SCHEMA}; aborting before tests touch public`);

  const redis = new IORedis('redis://localhost:6379/15');
  await redis.flushdb();
  await redis.quit();
}
