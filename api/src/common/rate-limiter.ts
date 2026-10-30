import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config';
import { RedisService } from '../redis/redis.module';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Sliding-window rate limiter on a Redis sorted set (one member per hit).
 * Exact over the window, atomic via MULTI, and shared by every API instance.
 */
@Injectable()
export class RateLimiter {
  constructor(
    private readonly redis: RedisService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  async hit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const fullKey = `${this.cfg.redisPrefix}:rl:${key}`;
    const now = Date.now();
    const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;
    const res = await this.redis.client
      .multi()
      .zremrangebyscore(fullKey, 0, now - windowMs)
      .zadd(fullKey, now, member)
      .zcard(fullKey)
      .zrange(fullKey, 0, 0, 'WITHSCORES')
      .pexpire(fullKey, windowMs)
      .exec();
    if (!res) throw new Error('rate limiter: redis transaction aborted');
    const count = Number(res[2][1]);
    const oldest = res[3][1] as string[];
    if (count > limit) {
      // Over the limit: drop this hit so a blocked client doesn't extend its own ban.
      await this.redis.client.zrem(fullKey, member);
      const oldestTs = oldest.length === 2 ? Number(oldest[1]) : now;
      return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((oldestTs + windowMs - now) / 1000)) };
    }
    return { allowed: true, remaining: limit - count, retryAfterSeconds: 0 };
  }
}
