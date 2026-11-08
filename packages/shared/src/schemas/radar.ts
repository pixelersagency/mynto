import { z } from 'zod';

/**
 * Wire schemas of the Radar integration (prospection B2B), shared by the
 * web proxy (apps/web/app/api/radar) and the scanner (apps/scanner/src/routes/radar.ts).
 * Contract documented in the Radar repo, docs/MYNTO.md.
 */

/** Tracking token of a /r/<token> link: base64url, 22 to 64 characters. */
export const RADAR_TRACKING_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

export const RadarCreateAuditRequestSchema = z.object({
  url: z.string().trim().url().max(2048),
  /** Radar's own prospect id (e.g. `cmp_...`). Idempotency key. */
  external_ref: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_.:-]{1,128}$/),
});
export type RadarCreateAuditRequest = z.infer<typeof RadarCreateAuditRequestSchema>;

/**
 * Body of the /r/<token> view beacon (navigator.sendBeacon): the token and
 * nothing else. The beacon fires once, after ~5 s of visible tab; it no
 * longer carries a session id, a reading time or the sections read (CNIL
 * art. 82: no browser storage, no reading analytics). Fields sent by pages
 * cached before this change (session_id, duration_s, sections_viewed,
 * final) are accepted and dropped.
 */
export const RadarViewBeaconSchema = z.object({
  token: z.string().regex(RADAR_TRACKING_TOKEN_PATTERN),
});
export type RadarViewBeacon = z.infer<typeof RadarViewBeaconSchema>;
