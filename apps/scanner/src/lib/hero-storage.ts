import { getMediaStorage, heroKey, isUuid } from '@mynto/db/media';

import { captureHeroScreenshot } from '../audit/collectors/hero-screenshot.js';
import { logger } from '../logger.js';

/**
 * Captures a viewport-sized hero screenshot of `url`, stores it in the
 * media store (MEDIA_DIR, `hero/<auditId>.png`) and returns its media
 * KEY (relative, persisted in audits_full.hero_screenshot_key). The web
 * app serves it at /media/hero/<auditId>.png. Returns null on any failure
 * (capture KO, write KO). Best-effort: never throws to the caller.
 *
 * The key is derived from the audit id, so a re-run of the same audit
 * overwrites the previous hero (idempotent).
 */
export async function captureAndStoreHero(auditId: string, url: string): Promise<string | null> {
  // Defense in depth: `auditId` comes from audits_full.id (UUID), but
  // locking the key shape here makes path traversal impossible if an
  // upstream refactor ever lets a tampered job through.
  if (!isUuid(auditId)) {
    logger.warn({ auditId }, 'hero_upload_rejected_invalid_audit_id');
    return null;
  }

  let png: Buffer | null;
  try {
    png = await captureHeroScreenshot(url);
  } catch (err) {
    logger.warn(
      { auditId, message: err instanceof Error ? err.message : 'unknown' },
      'hero_capture_threw',
    );
    return null;
  }
  if (!png) return null;

  const key = heroKey(auditId);
  try {
    await getMediaStorage().put(key, png, 'image/png');
  } catch (err) {
    logger.warn(
      { auditId, message: err instanceof Error ? err.message : 'unknown' },
      'hero_store_failed',
    );
    return null;
  }
  return key;
}

/** Removes the hero file of a purged audit. Best-effort. */
export async function deleteHero(key: string): Promise<void> {
  try {
    await getMediaStorage().delete(key);
  } catch (err) {
    logger.warn({ message: err instanceof Error ? err.message : 'unknown' }, 'hero_delete_failed');
  }
}
