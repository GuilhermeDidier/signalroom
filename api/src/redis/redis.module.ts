import { Global, Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import IORedis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config';

/**
 * One shared ioredis connection for rate limiting and health checks.
 * BullMQ requires `maxRetriesPerRequest: null` on connections it blocks on,
 * so queue/worker get their own connections (see documents/ingest.queue.ts).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: IORedis;

  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    // lazyConnect: connects on first command, so an instance that never needs Redis never opens a socket.
    this.client = new IORedis(cfg.redisUrl, { maxRetriesPerRequest: 2, lazyConnect: true });
  }

  async onModuleDestroy() {
    await closeRedis(this.client);
  }
}

/** QUIT when connected (graceful); otherwise drop the socket so shutdown never waits on a pending connect. */
export async function closeRedis(client: IORedis): Promise<void> {
  if (client.status === 'ready') {
    await client.quit().catch(() => client.disconnect());
  } else {
    client.disconnect();
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
