import 'server-only';

import { RADAR_TRACKING_TOKEN_PATTERN } from '@mynto/shared';
import { z } from 'zod';

import { db, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Resolves a Radar tracking token to the slug of its audit. Server-side
 * only. Only the slug leaves this function; the report itself is then
 * read through the public report query like /audit/full/[slug].
 */

const RowSchema = z.object({
  audits_full: z.object({ slug: z.string(), expires_at: z.string() }),
});

export type ResolveTokenResult =
  | { kind: 'ok'; slug: string }
  | { kind: 'not_found' }
  | { kind: 'error' };

export async function resolveRadarToken(token: string): Promise<ResolveTokenResult> {
  if (!RADAR_TRACKING_TOKEN_PATTERN.test(token)) return { kind: 'not_found' };
  let data: unknown;
  try {
    data = await db().radar.findByToken(token);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'radar_token_lookup_failed');
    return { kind: 'error' };
  }
  if (data === null) return { kind: 'not_found' };
  const parsed = RowSchema.safeParse(data);
  if (!parsed.success) return { kind: 'error' };
  if (Date.parse(parsed.data.audits_full.expires_at) <= Date.now()) return { kind: 'not_found' };
  return { kind: 'ok', slug: parsed.data.audits_full.slug };
}

/**
 * True when the audit behind this slug was created by Radar. Radar reports
 * are only reachable through /r/<token> (view counting, noindex), so the
 * public /audit/full/[slug] page refuses them. `source` is never part of
 * the public column list, hence this dedicated lookup. Fails open (false)
 * when the lookup is unavailable: the slug is unguessable and the public
 * report must not go down with it.
 */
export async function isRadarAuditSlug(slug: string): Promise<boolean> {
  try {
    return (await db().audits.getSourceBySlug(slug)) === 'radar';
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'radar_source_lookup_failed');
    return false;
  }
}
