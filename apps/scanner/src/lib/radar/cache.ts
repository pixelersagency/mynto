/**
 * 30-day per-domain cache for Radar audits.
 *
 * Radar often prospects several contacts at the same company, and a site
 * does not change in a few weeks. When a recent, non-failed Radar audit
 * already exists for the domain, the new request gets its own radar row
 * (own tracking token, own views) pointing at the existing scan instead
 * of paying for a new one.
 */

export const CACHE_MAX_AGE_DAYS = 30;
const DAY_MS = 24 * 3600 * 1000;

export interface CacheCandidate {
  auditId: string;
  auditStatus: string;
  /** audits_full.created_at (ISO). */
  auditCreatedAt: string;
  /** audits_full.expires_at (ISO). */
  auditExpiresAt: string;
}

/**
 * Returns the most recent reusable audit, or null.
 *
 * Reusable = scan created less than 30 days ago, not failed (queued and
 * running count: a second contact at the same company the same day must
 * not trigger a second scan), and not already expired.
 */
export function pickReusableAudit(
  candidates: readonly CacheCandidate[],
  now: Date = new Date(),
  maxAgeDays: number = CACHE_MAX_AGE_DAYS,
): CacheCandidate | null {
  const nowMs = now.getTime();
  const minCreated = nowMs - maxAgeDays * DAY_MS;
  let best: CacheCandidate | null = null;
  let bestCreated = -Infinity;
  for (const c of candidates) {
    if (c.auditStatus === 'failed') continue;
    const created = Date.parse(c.auditCreatedAt);
    const expires = Date.parse(c.auditExpiresAt);
    if (!Number.isFinite(created) || !Number.isFinite(expires)) continue;
    if (created <= minCreated || created > nowMs + 60_000) continue;
    if (expires <= nowMs) continue;
    if (created > bestCreated) {
      best = c;
      bestCreated = created;
    }
  }
  return best;
}
