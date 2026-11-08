'use server';

import { randomBytes } from 'node:crypto';

import { CUSTOM_FONT_ID, CUSTOM_FONT_MAX_BYTES, isCatalogFont, isWoff2 } from '@mynto/templates';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdminMutation } from '@/lib/auth/origin';
import { db, getMediaStorage, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface FontState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

const FontId = z
  .string()
  .refine((v) => isCatalogFont(v) || v === CUSTOM_FONT_ID, 'Police inconnue');

export async function saveFontsAction(_prev: FontState, form: FormData): Promise<FontState> {
  await requireAdminMutation();
  const parsed = z.object({ heading: FontId, body: FontId }).safeParse({
    heading: form.get('heading'),
    body: form.get('body'),
  });
  if (!parsed.success) return { ok: false, message: 'Choisis une police de la liste.' };
  try {
    const s = await db().reports.getSettings();
    if (
      (parsed.data.heading === CUSTOM_FONT_ID || parsed.data.body === CUSTOM_FONT_ID) &&
      s.custom_font_name === null
    ) {
      return { ok: false, message: 'Importe d’abord ta police.' };
    }
    await db().reports.setFonts(parsed.data.heading, parsed.data.body);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'fonts_save_failed');
    return { ok: false, message: 'Enregistrement impossible pour le moment.' };
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Polices enregistrées. Elles s’appliquent aux rapports et aux PDF.' };
}

async function readWoff2(
  file: FormDataEntryValue | null,
  field: string,
): Promise<Uint8Array | string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (file.size > CUSTOM_FONT_MAX_BYTES) return `${field} : 500 Ko maximum.`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!isWoff2(bytes)) return `${field} : ce fichier n’est pas un woff2.`;
  return bytes;
}

export async function uploadCustomFontAction(_prev: FontState, form: FormData): Promise<FontState> {
  await requireAdminMutation();
  const name = z
    .string()
    .trim()
    .min(1, 'Indique le nom de la police')
    .max(40, '40 caractères maximum')
    .regex(/^[\p{L}\p{N} _-]+$/u, 'Lettres, chiffres, espaces et tirets seulement')
    .safeParse(form.get('name'));
  if (!name.success)
    return { ok: false, message: null, fieldErrors: { name: name.error.issues[0]?.message ?? '' } };
  const regular = await readWoff2(form.get('regular'), 'Normal');
  const bold = await readWoff2(form.get('bold'), 'Gras');
  if (typeof regular === 'string') return { ok: false, message: null, fieldErrors: { regular } };
  if (typeof bold === 'string') return { ok: false, message: null, fieldErrors: { bold } };
  if (regular === null)
    return { ok: false, message: null, fieldErrors: { regular: 'Le fichier normal est requis.' } };

  const media = getMediaStorage();
  const keys: string[] = [];
  try {
    const regularKey = `fonts/${randomBytes(12).toString('hex')}.woff2`;
    await media.put(regularKey, Buffer.from(regular), 'font/woff2');
    keys.push(regularKey);
    let boldKey: string | null = null;
    if (bold !== null) {
      boldKey = `fonts/${randomBytes(12).toString('hex')}.woff2`;
      await media.put(boldKey, Buffer.from(bold), 'font/woff2');
      keys.push(boldKey);
    }
    const { previous } = await db().reports.setCustomFont({ name: name.data, regularKey, boldKey });
    await Promise.all(previous.map((k) => media.delete(k).catch(() => undefined)));
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'custom_font_upload_failed');
    await Promise.all(keys.map((k) => media.delete(k).catch(() => undefined)));
    return { ok: false, message: 'Import impossible pour le moment.' };
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Police importée. Choisis-la pour les titres ou le texte.' };
}

export async function removeCustomFontAction(): Promise<FontState> {
  await requireAdminMutation();
  try {
    const s = await db().reports.getSettings();
    const { previous } = await db().reports.setCustomFont({
      name: null,
      regularKey: null,
      boldKey: null,
    });
    const media = getMediaStorage();
    await Promise.all(previous.map((k) => media.delete(k).catch(() => undefined)));
    await db().reports.setFonts(
      s.heading_font === CUSTOM_FONT_ID ? 'inter' : s.heading_font,
      s.body_font === CUSTOM_FONT_ID ? 'inter' : s.body_font,
    );
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'custom_font_remove_failed');
    return { ok: false, message: 'Suppression impossible pour le moment.' };
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Police retirée. Inter la remplace.' };
}
