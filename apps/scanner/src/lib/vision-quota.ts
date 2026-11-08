import { config } from '../config.js';
import { logger } from '../logger.js';
import { redis } from '../redis.js';

/**
 * Daily quota gate for the Gemini vision pipeline.
 *
 * The audit-creation rate-limit (3/day/email + 10/h/IP) protects against
 * a single attacker, but does not bound the *aggregate* Gemini cost. A
 * persistent attacker rotating emails could burn the budget over time.
 * This counter is the global ceiling.
 *
 * Mechanics : `INCR vision:calls:YYYY-MM-DD` then EXPIRE 48h on first
 * write. Returns true when the call is allowed, false when the daily
 * cap was hit.
 *
 * Returns true on Redis failure (fail-open). The counter is a
 * cost-control measure, not a security boundary — degrading vision when
 * Redis is down would create a worse availability problem than the
 * potential cost spike on an unrelated outage.
 */
export async function reserveVisionSlot(): Promise<boolean> {
  const cap = config.VISION_DAILY_QUOTA;
  if (cap <= 0) return false;

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `vision:calls:${today}`;

  try {
    const next = await redis.incr(key);
    // Set TTL only on first write of the day (next === 1) so
    // subsequent INCR doesn't reset the window.
    if (next === 1) {
      await redis.expire(key, 48 * 60 * 60);
    }
    if (next > cap) {
      logger.warn({ next, cap }, 'vision_daily_quota_exhausted');
      return false;
    }
    // Soft-warn at 80% so we can act before hitting the wall.
    if (next === Math.floor(cap * 0.8)) {
      logger.warn({ next, cap }, 'vision_daily_quota_80pct');
    }
    return true;
  } catch (err) {
    logger.warn(
      { message: err instanceof Error ? err.message : 'unknown' },
      'vision_quota_redis_failed',
    );
    // Fail-open : prefer running vision over breaking the audit when
    // Redis is degraded (cost will catch up via Gemini billing alerts).
    return true;
  }
}
