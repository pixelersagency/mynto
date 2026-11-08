'use server';

import {
  TEMPLATE_ID_PATTERN,
  checkTemplateStatic,
  isReservedTemplateId,
  resolveTemplateAlias,
  readTemplateZip,
  sanitizeSettingsInput,
  type RenderResult,
  type TemplateBundle,
} from '@mynto/templates';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdminMutation } from '@/lib/auth/origin';
import { db, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';
import { renderTemplatePreview } from '@/lib/reports/render';
import { loadTemplateBundle } from '@/lib/reports/templates';

/**
 * Template gallery mutations. Imported and duplicated templates are
 * validated (files, CSS, markup) and rendered on the example data before
 * they are stored: a template that does not pass never reaches the DB.
 */

export interface TemplateActionState {
  ok: boolean;
  message: string | null;
  issues?: string[];
}

// Retired built-in ids (standard, compact, commercial) are written under their replacement.
const IdSchema = z.string().regex(TEMPLATE_ID_PATTERN).transform(resolveTemplateAlias);

function done(message: string): TemplateActionState {
  revalidatePath('/dashboard/reglages/modeles', 'layout');
  return { ok: true, message };
}

async function storeChecked(bundle: TemplateBundle): Promise<TemplateActionState | null> {
  const report = await checkTemplateStatic(bundle);
  if (!report.ok) {
    return {
      ok: false,
      message: 'Le modèle ne passe pas la vérification.',
      issues: report.issues
        .filter((i) => i.level === 'error')
        .slice(0, 12)
        .map((i) => `${i.file ?? 'modèle'} : ${i.message}`),
    };
  }
  await db().reports.upsertCustom({
    id: bundle.manifest.id,
    manifest: bundle.manifest,
    files: bundle.files,
    preview: bundle.preview,
  });
  return null;
}

export async function setTemplateEnabledAction(
  id: unknown,
  enabled: unknown,
): Promise<TemplateActionState> {
  await requireAdminMutation();
  const parsed = z.object({ id: IdSchema, enabled: z.boolean() }).safeParse({ id, enabled });
  if (!parsed.success) return { ok: false, message: 'Requête invalide.' };
  try {
    const settings = await db().reports.getSettings();
    if (!parsed.data.enabled && settings.default_template_id === parsed.data.id) {
      return {
        ok: false,
        message: 'Le modèle par défaut reste actif. Choisis d’abord un autre défaut.',
      };
    }
    await db().reports.setEnabled(parsed.data.id, parsed.data.enabled);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'template_enable_failed');
    return { ok: false, message: 'Enregistrement impossible pour le moment.' };
  }
  return done(parsed.data.enabled ? 'Modèle activé.' : 'Modèle désactivé.');
}

export async function setDefaultTemplateAction(id: unknown): Promise<TemplateActionState> {
  await requireAdminMutation();
  const parsed = IdSchema.safeParse(id);
  if (!parsed.success || (await loadTemplateBundle(parsed.data)) === null) {
    return { ok: false, message: 'Modèle introuvable.' };
  }
  try {
    await db().reports.setEnabled(parsed.data, true);
    await db().reports.setDefaultTemplate(parsed.data);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'template_default_failed');
    return { ok: false, message: 'Enregistrement impossible pour le moment.' };
  }
  return done('Modèle par défaut mis à jour.');
}

const DuplicateSchema = z.object({
  source: IdSchema,
  id: z
    .string()
    .trim()
    .regex(TEMPLATE_ID_PATTERN, 'Identifiant : minuscules, chiffres et tirets, 2 à 40 caractères'),
  name: z.string().trim().min(1, 'Indique un nom').max(60),
});

export async function duplicateTemplateAction(
  _prev: TemplateActionState,
  form: FormData,
): Promise<TemplateActionState> {
  await requireAdminMutation();
  const parsed = DuplicateSchema.safeParse({
    source: form.get('source'),
    id: form.get('id'),
    name: form.get('name'),
  });
  if (!parsed.success)
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Champs invalides.' };
  const { source, id, name } = parsed.data;
  if (isReservedTemplateId(id) || (await loadTemplateBundle(id)) !== null) {
    return { ok: false, message: 'Cet identifiant est déjà pris.' };
  }
  const base = await loadTemplateBundle(source);
  if (base === null) return { ok: false, message: 'Modèle source introuvable.' };
  const manifest = { ...base.manifest, id, name, version: '1.0.0', based_on: source };
  delete (manifest as { author?: string }).author;
  const bundle: TemplateBundle = {
    manifest,
    files: { ...base.files, 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n` },
    preview: base.preview,
    builtin: false,
  };
  try {
    const refused = await storeChecked(bundle);
    if (refused) return refused;
    const st = await db().reports.getState(source);
    if (st && Object.keys(st.settings).length > 0)
      await db().reports.saveTemplateSettings(id, st.settings);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'template_duplicate_failed');
    return { ok: false, message: 'Duplication impossible pour le moment.' };
  }
  return done(`« ${name} » créé. Exporte-le pour le modifier, puis réimporte-le.`);
}

export async function importTemplateAction(
  _prev: TemplateActionState,
  form: FormData,
): Promise<TemplateActionState> {
  await requireAdminMutation();
  const file = form.get('zip');
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, message: 'Choisis un fichier .zip.' };
  if (file.size > 2 * 1024 * 1024) return { ok: false, message: 'L’archive dépasse 2 Mo.' };
  const res = readTemplateZip(new Uint8Array(await file.arrayBuffer()));
  if (!res.ok) {
    return {
      ok: false,
      message: 'Archive refusée.',
      issues: res.issues
        .filter((i) => i.level === 'error')
        .slice(0, 12)
        .map((i) => `${i.file ?? 'archive'} : ${i.message}`),
    };
  }
  const id = res.bundle.manifest.id;
  if (isReservedTemplateId(id)) {
    return {
      ok: false,
      message: `« ${id} » est réservé aux modèles intégrés. Change l’id dans manifest.json.`,
    };
  }
  const exists = (await db().reports.getCustom(id)) !== null;
  if (exists && form.get('replace') !== 'on') {
    return {
      ok: false,
      message: `Un modèle « ${id} » existe déjà. Active « Remplacer » pour l’écraser.`,
    };
  }
  try {
    const refused = await storeChecked(res.bundle);
    if (refused) return refused;
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'template_import_failed');
    return { ok: false, message: 'Import impossible pour le moment.' };
  }
  return done(
    exists
      ? `« ${res.bundle.manifest.name} » remplacé.`
      : `« ${res.bundle.manifest.name} » importé.`,
  );
}

export async function deleteTemplateAction(id: unknown): Promise<TemplateActionState> {
  await requireAdminMutation();
  const parsed = IdSchema.safeParse(id);
  if (!parsed.success || isReservedTemplateId(parsed.data)) {
    return { ok: false, message: 'Les modèles intégrés ne se suppriment pas.' };
  }
  try {
    await db().reports.deleteCustom(parsed.data);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'template_delete_failed');
    return { ok: false, message: 'Suppression impossible pour le moment.' };
  }
  return done('Modèle supprimé. Ses audits utilisent maintenant le modèle par défaut.');
}

export async function saveTemplateSettingsAction(
  id: unknown,
  values: unknown,
): Promise<TemplateActionState> {
  await requireAdminMutation();
  const parsed = z
    .object({ id: IdSchema, values: z.record(z.unknown()) })
    .safeParse({ id, values });
  if (!parsed.success) return { ok: false, message: 'Requête invalide.' };
  const bundle = await loadTemplateBundle(parsed.data.id);
  if (bundle === null) return { ok: false, message: 'Modèle introuvable.' };
  try {
    await db().reports.saveTemplateSettings(
      parsed.data.id,
      sanitizeSettingsInput(bundle.manifest, parsed.data.values),
    );
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'template_settings_save_failed');
    return { ok: false, message: 'Enregistrement impossible pour le moment.' };
  }
  revalidatePath(`/dashboard/reglages/modeles/${parsed.data.id}`);
  return { ok: true, message: 'Réglages du modèle enregistrés.' };
}

export async function resetTemplateSettingsAction(id: unknown): Promise<TemplateActionState> {
  await requireAdminMutation();
  const parsed = IdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, message: 'Requête invalide.' };
  await db().reports.resetTemplateSettings(parsed.data);
  revalidatePath(`/dashboard/reglages/modeles/${parsed.data}`);
  return { ok: true, message: 'Réglages par défaut rétablis.' };
}

/** Live preview of unsaved settings (example audit, real branding). */
export async function previewTemplateAction(
  id: unknown,
  values: unknown,
): Promise<RenderResult | { error: string }> {
  await requireAdminMutation();
  const parsed = z
    .object({ id: IdSchema, values: z.record(z.unknown()) })
    .safeParse({ id, values });
  if (!parsed.success) return { error: 'Requête invalide.' };
  const bundle = await loadTemplateBundle(parsed.data.id);
  if (bundle === null) return { error: 'Modèle introuvable.' };
  try {
    return await renderTemplatePreview(
      bundle,
      sanitizeSettingsInput(bundle.manifest, parsed.data.values),
    );
  } catch {
    return { error: 'Aperçu impossible : le modèle ne se rend pas.' };
  }
}
