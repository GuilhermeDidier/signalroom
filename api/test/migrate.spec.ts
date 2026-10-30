import { Client } from 'pg';
import { defaultMigrationsDir, runMigrations } from '../scripts/migrate';

/**
 * Regression: with search_path `<fresh>,public` and the tables already in
 * public, the runner used to "baseline" (skip) 001 because to_regclass('tenants')
 * resolved through the public fallback, leaving the fresh schema empty.
 */
describe('migration runner', () => {
  const schema = 'signalroom_test_migrate';
  const url = process.env.DATABASE_URL!;
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: url });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.query(`CREATE SCHEMA ${schema}`);
  });
  afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  });

  it('creates the tables in the current schema even when a fallback schema already has them', async () => {
    const client = new Client({ connectionString: url, options: `-c search_path=${schema},public` });
    await client.connect();
    try {
      const fallback = await client.query<{ ok: boolean }>(`SELECT to_regclass('public.tenants') IS NOT NULL AS ok`);
      expect(fallback.rows[0].ok).toBe(true); // precondition: the trap exists

      const applied = await runMigrations(client, defaultMigrationsDir(), () => undefined);
      expect(applied[0]).toBe('001_init.sql');
      const { rows } = await client.query<{ ok: boolean }>(`SELECT to_regclass('${schema}.tenants') IS NOT NULL AS ok`);
      expect(rows[0].ok).toBe(true);

      expect(await runMigrations(client, defaultMigrationsDir(), () => undefined)).toEqual([]); // idempotent
    } finally {
      await client.end();
    }
  });
});
