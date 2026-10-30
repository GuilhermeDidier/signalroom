import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../common/decorators';
import { DbService } from '../db/db.service';
import { RedisService } from '../redis/redis.module';

/** Resolves to 'ok' or an `error: ...` description. */
async function check(fn: () => Promise<unknown>, timeoutMs = 2_000): Promise<string> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return 'ok';
  } catch (err) {
    return `error: ${(err as Error).message}`;
  } finally {
    clearTimeout(timer);
  }
}

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly db: DbService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  async health(@Res() res: Response) {
    const [db, redis] = await Promise.all([check(() => this.db.query('SELECT 1')), check(() => this.redis.client.ping())]);
    const ok = db === 'ok' && redis === 'ok';
    res.status(ok ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).json({ ok, db, redis });
  }
}
