import { db } from '@mynto/db';

import { deleteHero } from '../lib/hero-storage.js';
import { logger } from '../logger.js';

/** Grace period after expires_at before the row is physically deleted. */
export const PURGE_GRACE_DAYS = 1;

/**
 * Physically deletes audits expired for more than PURGE_GRACE_DAYS (the
 * public read paths already hide them from expires_at on). Findings,
 * views and Radar rows go with them (ON DELETE CASCADE); hero screenshots
 * are removed from the media store afterwards (best-effort: an orphan
 * file is harmless, a dangling row is not).
 */
export async function processPurge(): Promise<{ deleted: number }> {
  const purged = await db().audits.purgeExpired(PURGE_GRACE_DAYS);
  for (const row of purged) {
    if (row.hero_screenshot_key !== null) await deleteHero(row.hero_screenshot_key);
    if (row.favicon_key !== null) await deleteHero(row.favicon_key);
  }
  logger.info({ deleted: purged.length }, 'purge_expired_audits_done');
  // Webhook delivery log: 30 days.
  const webhooks = await db()
    .webhooks.purgeOld()
    .catch((err: unknown) => {
      logger.error(
        { err: err instanceof Error ? err.message : 'unknown' },
        'purge_webhooks_failed',
      );
      return null;
    });
  if (webhooks !== null) logger.info(webhooks, 'purge_webhook_log_done');
  // Report views (only kept for the 30-minute dedupe): 90 days.
  const views = await db()
    .views.purgeOld()
    .catch((err: unknown) => {
      logger.error(
        { err: err instanceof Error ? err.message : 'unknown' },
        'purge_audit_views_failed',
      );
      return null;
    });
  if (views !== null) logger.info({ deleted: views }, 'purge_audit_views_done');
  return { deleted: purged.length };
}
