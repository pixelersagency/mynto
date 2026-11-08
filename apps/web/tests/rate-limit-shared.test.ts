// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { createSharedRateLimiter, type RateLimitRedis } from '@/lib/rate-limit-shared';

/** In-memory stand-in for Redis MULTI / INCR / PEXPIRE, shared by "processes". */
function fakeRedis(
  store = new Map<string, number>(),
): RateLimitRedis & { store: Map<string, number> } {
  return {
    store,
    multi: () => {
      const ops: (() => [null, unknown])[] = [];
      const tx = {
        incr: (k: string) => {
          ops.push(() => {
            const v = (store.get(k) ?? 0) + 1;
            store.set(k, v);
            return [null, v];
          });
          return tx;
        },
        pexpire: () => {
          ops.push(() => [null, 1]);
          return tx;
        },
        exec: () => Promise.resolve(ops.map((op) => op())),
      };
      return tx;
    },
  };
}

describe('shared rate limit', () => {
  it('two web processes share one counter per key', async () => {
    const redis = fakeRedis();
    const now = () => 1_000;
    const a = createSharedRateLimiter(redis, { now });
    const b = createSharedRateLimiter(redis, { now });
    expect((await a('apikey:k1', 3, 60_000)).ok).toBe(true);
    expect((await b('apikey:k1', 3, 60_000)).ok).toBe(true);
    expect(await a('apikey:k1', 3, 60_000)).toEqual({ ok: true, remaining: 0 });
    expect(await b('apikey:k1', 3, 60_000)).toEqual({ ok: false, remaining: 0 });
    // Another key has its own budget.
    expect((await b('apikey:k2', 3, 60_000)).ok).toBe(true);
  });

  it('starts a new window after windowMs', async () => {
    let t = 0;
    const limit = createSharedRateLimiter(fakeRedis(), { now: () => t });
    await limit('k', 1, 60_000);
    expect((await limit('k', 1, 60_000)).ok).toBe(false);
    t = 60_000;
    expect((await limit('k', 1, 60_000)).ok).toBe(true);
  });

  it('falls back to the in-memory limiter when Redis fails', async () => {
    const broken: RateLimitRedis = {
      multi: () => ({
        incr: () => undefined,
        pexpire: () => undefined,
        exec: () => Promise.reject(new Error('Connection is closed.')),
      }),
    };
    const onFallback = vi.fn();
    const limit = createSharedRateLimiter(broken, { onFallback });
    expect((await limit('fallback-key', 1, 60_000)).ok).toBe(true);
    expect((await limit('fallback-key', 1, 60_000)).ok).toBe(false);
    expect(onFallback).toHaveBeenCalledTimes(2);
  });

  it('uses memory when no Redis is configured', async () => {
    const limit = createSharedRateLimiter(null);
    expect((await limit('memory-key', 1, 60_000)).ok).toBe(true);
    expect((await limit('memory-key', 1, 60_000)).ok).toBe(false);
  });
});
