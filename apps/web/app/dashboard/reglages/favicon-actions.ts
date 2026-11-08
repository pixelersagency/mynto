'use server';

import { randomBytes } from 'node:crypto';

import { revalidatePath } from 'next/cache';

import type { FormState } from '../actions';

import { requireAdminMutation } from '@/lib/auth/origin';
import { envBrandingDefaults } from '@/lib/branding';
import { db, getMediaStorage, newBrandFaviconKey, pgErrorCode } from '@/lib/db';
import { FAVICON_MAX_BYTES, checkFavicon } from '@/lib/favicon';
import { logger } from '@/lib/logger';

/**
 * Agency favicon (Réglages > Marque). Same flow as the logo: admin session
 * and Origin checked first, type checked by content, file written to
 * MEDIA_DIR under a random key, then the key saved and the old file removed.
 */

export async function uploadFaviconAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdminMutation();
  const file = form.get('favicon');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: null, fieldErrors: { favicon: 'Choisis un fichier.' } };
  }
  if (file.size > FAVICON_MAX_BYTES) {
    return { ok: false, message: null, fieldErrors: { favicon: 'Le favicon dépasse 256 Ko.' } };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkFavicon(bytes);
  if (!check.ok) return { ok: false, message: null, fieldErrors: { favicon: check.error } };

  const key = newBrandFaviconKey(check.ext, randomBytes(12).toString('hex'));
  const media = getMediaStorage();
  try {
    await media.put(key, Buffer.from(bytes), check.contentType);
    const { previous } = await db().settings.setFaviconKey(key, envBrandingDefaults());
    if (previous !== null && previous !== key) await media.delete(previous).catch(() => undefined);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'favicon_upload_failed');
    await media.delete(key).catch(() => undefined);
    return { ok: false, message: 'Envoi du favicon impossible pour le moment.' };
  }
  logger.info({ ext: check.ext }, 'favicon_uploaded');
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Favicon mis à jour.' };
}

export async function removeFaviconAction(): Promise<FormState> {
  await requireAdminMutation();
  try {
    const { previous } = await db().settings.setFaviconKey(null, envBrandingDefaults());
    if (previous !== null)
      await getMediaStorage()
        .delete(previous)
        .catch(() => undefined);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'favicon_remove_failed');
    return { ok: false, message: 'Suppression impossible pour le moment.' };
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Favicon retiré.' };
}
