/**
 * Daily quota of NEW Radar scans, counted per Paris calendar day.
 *
 * Pure date helpers + a counter that takes its Redis client as a
 * parameter, so the logic is testable without a live Redis (the caller in
 * routes/radar.ts passes the shared ioredis client).
 */

export const PARIS_TZ = 'Europe/Paris';

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = fmt.formatToParts(date).find((p) => p.type === type);
    return part ? Number(part.value) : 0;
  };
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset in ms between `timeZone` wall clock and UTC at `date`. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** `YYYY-MM-DD` of `date` on the Paris wall clock. */
export function parisDayKey(date: Date): string {
  const p = zonedParts(date, PARIS_TZ);
  return `${p.year.toString().padStart(4, '0')}-${p.month.toString().padStart(2, '0')}-${p.day
    .toString()
    .padStart(2, '0')}`;
}

/** UTC instant of the next 00:00 on the Paris wall clock after `date`. */
export function nextParisMidnight(date: Date): Date {
  const p = zonedParts(date, PARIS_TZ);
  // Date.UTC normalises day overflow (31 -> next month).
  const guess = Date.UTC(p.year, p.month - 1, p.day + 1, 0, 0, 0);
  let result = guess - zoneOffsetMs(new Date(guess), PARIS_TZ);
  // Re-evaluate the offset at the candidate instant (DST switch days).
  const corrected = guess - zoneOffsetMs(new Date(result), PARIS_TZ);
  if (corrected !== result) result = corrected;
  return new Date(result);
}

export function quotaKey(date: Date): string {
  return `radar:quota:${parisDayKey(date)}`;
}

/** Minimal Redis surface used by the counter. */
export interface QuotaRedis {
  incr: (key: string) => Promise<number>;
  decr: (key: string) => Promise<number>;
  expire: (key: string, seconds: number) => Promise<number>;
}

export type QuotaReservation =
  | { ok: true; key: string; count: number }
  | { ok: false; reason: 'quota_exceeded'; limit: number; resetsAt: string }
  | { ok: false; reason: 'backend_unavailable' };

const KEY_TTL_SECONDS = 48 * 3600;

/**
 * Reserves one slot for today. Over the limit, the increment is rolled
 * back so a burst of refused calls does not keep the counter climbing.
 *
 * Fails CLOSED on Redis errors: this is a cost guard on paid scans, and an
 * unbounded number of scans during a Redis outage is the worse failure.
 */
export async function reserveQuotaSlot(
  redis: QuotaRedis,
  limit: number,
  now: Date = new Date(),
): Promise<QuotaReservation> {
  const key = quotaKey(now);
  try {
    if (limit <= 0) {
      return {
        ok: false,
        reason: 'quota_exceeded',
        limit,
        resetsAt: nextParisMidnight(now).toISOString(),
      };
    }
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, KEY_TTL_SECONDS);
    if (count > limit) {
      await redis.decr(key);
      return {
        ok: false,
        reason: 'quota_exceeded',
        limit,
        resetsAt: nextParisMidnight(now).toISOString(),
      };
    }
    return { ok: true, key, count };
  } catch {
    return { ok: false, reason: 'backend_unavailable' };
  }
}

/** Gives a slot back (insert failed after the reservation). Best-effort. */
export async function releaseQuotaSlot(redis: QuotaRedis, key: string): Promise<void> {
  try {
    await redis.decr(key);
  } catch {
    // The slot is lost for the day; acceptable for a best-effort rollback.
  }
}
