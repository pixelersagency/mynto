import { createHmac, randomBytes } from 'node:crypto';

import { RadarViewBeaconSchema, type RadarViewBeacon } from '@mynto/shared';

/**
 * Pure helpers for the tracking link view counter (POST /api/radar/views).
 *
 * Since migration 0002 a view only answers "was this link opened?" (CNIL
 * art. 82: no browser storage, no reading time, no sections read). The
 * server dedupes on (link, HMAC of the client IP) over 30 minutes and stores
 * the time plus a coarse browser family. No raw User-Agent, no country.
 */

export const VIEW_DEDUPE_WINDOW_MS = 30 * 60 * 1000;
export { UA_FAMILY_MAX_LENGTH } from '@mynto/shared';

/** Wire schema shared with the web proxy (packages/shared). */
export const RadarViewBodySchema = RadarViewBeaconSchema;
export type RadarViewBody = RadarViewBeacon;

/**
 * Secret of the IP hash. AUDIT_VIEWS_IP_HASH_SECRET when set; otherwise a
 * random per-process secret, so the dedupe still works while hashes stay
 * unlinkable across restarts (and nobody can reverse them).
 */
export function viewHashSecret(configured: string | undefined): string {
  return configured !== undefined && configured.length > 0
    ? configured
    : randomBytes(32).toString('hex');
}

/** HMAC-SHA256 of the client IP. Null when the IP is unknown (no dedupe). */
export function hashIp(ip: string | null, secret: string): string | null {
  if (!ip) return null;
  return createHmac('sha256', secret).update(ip).digest('hex');
}

export { userAgentFamily } from '@mynto/shared';
