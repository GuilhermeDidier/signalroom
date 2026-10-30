import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { APP_CONFIG, AppConfig } from '../config';

/** Anything that can run a query: the pool, or a client inside a transaction. */
export interface Queryable {
  query<R extends QueryResultRow>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

export function createPool(cfg: Pick<AppConfig, 'databaseUrl' | 'databaseSearchPath' | 'databasePoolMax'>): Pool {
  return new Pool({
    connectionString: cfg.databaseUrl,
    max: cfg.databasePoolMax,
    // Never hardcode a schema: rely on the role's search_path unless one is given.
    options: cfg.databaseSearchPath ? `-c search_path=${cfg.databaseSearchPath.replace(/\s+/g, "")}` : undefined,
  });
}

@Injectable()
export class DbService implements Queryable, OnModuleDestroy {
  readonly pool: Pool;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    this.pool = createPool(cfg);
  }

  async query<R extends QueryResultRow>(text: string, params: unknown[] = []) {
    return this.pool.query<R>(text, params);
  }

  /** Runs `fn` in a transaction; rolls back on any thrown error. */
  async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
