import { Redis } from 'ioredis';

import { logger } from './logger';
import { rateLimit, type RateLimitResult } from './rate-limit';

/**
 * Rate limit shared by every web process through Redis (fixed window,
 * INCR + PEXPIRE on `rl:<key>:<window>`), used by the public API and the
 * MCP endpoint so the per-key limit holds with several web replicas.
 *
 * REDIS_URL unset (single process, `next dev`): the in-memory limiter.
 * Redis unreachable or slow: the in-memory limiter too, for that call. A
 * Redis outage must never take the API down; the limit then holds per
 * process, as before.
 */

/** The part of ioredis this module needs (a fake implements it in tests). */
export interface RateLimitRedis {
  multi: () => {
    incr: (key: string) => unknown;
    pexpire: (key: string, ms: number) => unknown;
    exec: () => Promise<[Error | null, unknown][] | null>;
  };
}

export function createSharedRateLimiter(
  client: RateLimitRedis | null,
  opts: { now?: () => number; onFallback?: (err: unknown) => void } = {},
) {
  const now = opts.now ?? Date.now;
  return async function sharedRateLimit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<RateLimitResult> {
    if (client === null) return rateLimit(key, limit, windowMs, now());
    const window = Math.floor(now() / windowMs);
    const redisKey = `rl:${key}:${String(window)}`;
    try {
      const tx = client.multi();
      tx.incr(redisKey);
      // Slightly longer than the window: the key dies on its own.
      tx.pexpire(redisKey, windowMs + 1_000);
      const res = await tx.exec();
      const first = res?.[0];
      if (first?.[0] !== null || typeof first[1] !== 'number') {
        throw new Error('unexpected redis reply');
      }
      const count = first[1];
      return { ok: count <= limit, remaining: Math.max(0, limit - count) };
    } catch (err) {
      opts.onFallback?.(err);
      return rateLimit(key, limit, windowMs, now());
    }
  };
}

let client: Redis | null | undefined;
let lastWarn = 0;

function redisClient(): Redis | null {
  if (client !== undefined) return client;
  const url = process.env.REDIS_URL;
  if (url === undefined || url === '') {
    client = null;
    return client;
  }
  client = new Redis(url, {
    // Fail fast: a request never waits on a sick Redis, it falls back.
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2_000,
    commandTimeout: 500,
    lazyConnect: false,
  });
  client.on('error', (err: Error) => {
    if (Date.now() - lastWarn > 60_000) {
      lastWarn = Date.now();
      logger.warn({ err: err.message }, 'rate_limit_redis_error');
    }
  });
  return client;
}

let limiter: ReturnType<typeof createSharedRateLimiter> | null = null;

export function sharedRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  limiter ??= createSharedRateLimiter(redisClient(), {
    onFallback: (err) => {
      if (Date.now() - lastWarn > 60_000) {
        lastWarn = Date.now();
        logger.warn(
          { err: err instanceof Error ? err.message : 'unknown' },
          'rate_limit_fallback_memory',
        );
      }
    },
  });
  return limiter(key, limit, windowMs);
}

/** Closes the Redis connection (graceful shutdown). */
export async function closeSharedRateLimit(): Promise<void> {
  const c = client;
  client = undefined;
  limiter = null;
  if (c) {
    if (c.status === 'ready') await c.quit().catch(() => undefined);
    else c.disconnect();
  }
}
