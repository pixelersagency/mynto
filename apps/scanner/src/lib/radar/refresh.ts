/**
 * Refresh of a Radar audit: a new scan is run and every radar row that
 * pointed at the old scan is repointed to the new one. The tracking token
 * (and therefore the /r/<token> link already sent by email) does not change,
 * and views stay attached to the radar row.
 */

/** A scan younger than this is not rescanned: the call returns it as is. */
export const REFRESH_MIN_AGE_HOURS = 24;
const HOUR_MS = 3600 * 1000;

export interface RefreshCandidate {
  /** audits_full.status */
  status: string;
  /** audits_full.created_at (ISO) */
  createdAt: string;
}

export type RefreshDecision = 'refresh' | 'in_progress' | 'fresh';

/**
 * Should the scan behind a radar row be replaced?
 * - queued/running: a scan is already underway, never start a second one;
 * - failed: always rescan;
 * - otherwise rescan only when older than `minAgeHours` (idempotent retries).
 */
export function decideRefresh(
  scan: RefreshCandidate,
  now: Date = new Date(),
  minAgeHours: number = REFRESH_MIN_AGE_HOURS,
): RefreshDecision {
  if (scan.status === 'queued' || scan.status === 'running') return 'in_progress';
  if (scan.status === 'failed') return 'refresh';
  const created = Date.parse(scan.createdAt);
  if (!Number.isFinite(created)) return 'refresh';
  return now.getTime() - created >= minAgeHours * HOUR_MS ? 'refresh' : 'fresh';
}
