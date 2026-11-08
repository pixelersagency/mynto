'use server';

import { randomBytes } from 'node:crypto';

import { AgencySettingsInputSchema } from '@mynto/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';

import { endSession } from '@/lib/auth/admin';
import { requireAdminMutation } from '@/lib/auth/origin';
import { envBrandingDefaults } from '@/lib/branding';
import { modulesFromForm, overrideFromModules } from '@/lib/dashboard/modules-form';
import { db, getMediaStorage, newBrandLogoKey, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';
import { checkLogo } from '@/lib/logo';
import { ServiceError, createAudit, deleteAudit, refreshAudit } from '@/lib/services/audits';

/**
 * Dashboard mutations. Every action starts with requireAdmin(): a server
 * action is a public POST endpoint whatever page it is attached to, so the
 * middleware is not enough on its own.
 */

export interface FormState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

const CreateAuditSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'Indique l’adresse du site.')
    .max(2048, 'Adresse trop longue.')
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .refine((v) => {
      try {
        const u = new URL(v);
        return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
      } catch {
        return false;
      }
    }, 'Cette adresse ne ressemble pas à un site web.'),
  label: z
    .string()
    .trim()
    .max(120, '120 caractères maximum.')
    .transform((v) => (v.length === 0 ? undefined : v)),
});

export async function createAuditAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdminMutation();
  const parsed = CreateAuditSchema.safeParse({
    url: form.get('url') ?? '',
    label: form.get('label') ?? '',
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? 'form');
      fieldErrors[k] ??= issue.message;
    }
    return { ok: false, message: null, fieldErrors };
  }

  const modules = modulesFromForm(form);
  const rawTemplate = form.get('template');
  const template =
    typeof rawTemplate === 'string' && /^[a-z][a-z0-9-]{1,39}$/.test(rawTemplate)
      ? rawTemplate
      : undefined;
  if (!modules.ok) return { ok: false, message: null, fieldErrors: { axes: modules.error } };

  let id: string;
  try {
    const audit = await createAudit(
      {
        url: parsed.data.url,
        label: parsed.data.label,
        modules: overrideFromModules(modules.modules),
        ...(template !== undefined ? { template } : {}),
      },
      'dashboard',
    );
    id = audit.id;
  } catch (err) {
    if (err instanceof ServiceError) {
      return err.status === 400
        ? { ok: false, message: null, fieldErrors: { url: err.message } }
        : { ok: false, message: err.message };
    }
    logger.error({ err: (err as Error).name }, 'dashboard_create_audit_failed');
    return {
      ok: false,
      message: 'Le scanner n’a pas pu lancer l’audit. Réessaye dans un instant.',
    };
  }
  revalidatePath('/dashboard', 'layout');
  redirect(`/dashboard/audits/${encodeURIComponent(id)}?vue=en-cours`);
}

const IdsSchema = z.array(z.string().uuid()).min(1).max(100);

export interface BulkResult {
  ok: boolean;
  done: number;
  skipped: number;
  failed: number;
  message: string;
  /** Ids the action could not process (the table restores them). */
  failedIds?: string[];
}

async function forEachId(
  ids: unknown,
  run: (id: string) => Promise<'done' | 'skipped' | 'failed'>,
): Promise<{ done: number; skipped: number; failed: number; failedIds: string[] } | null> {
  const parsed = IdsSchema.safeParse(ids);
  if (!parsed.success) return null;
  const counts = { done: 0, skipped: 0, failed: 0, failedIds: [] as string[] };
  // Sequential on purpose: the scanner rate-limits and each call is small.
  for (const id of [...new Set(parsed.data)]) {
    const outcome = await run(id);
    counts[outcome] += 1;
    if (outcome === 'failed') counts.failedIds.push(id);
  }
  return counts;
}

export async function refreshAuditsAction(ids: string[]): Promise<BulkResult> {
  await requireAdminMutation();
  try {
    const counts = await forEachId(ids, async (id) => {
      try {
        return (await refreshAudit(id)).refreshed ? 'done' : 'skipped';
      } catch (err) {
        if (err instanceof ServiceError && err.status === 503) throw err;
        logger.warn(
          { code: err instanceof ServiceError ? err.code : 'unknown' },
          'dashboard_refresh_refused',
        );
        return 'failed';
      }
    });
    if (counts === null)
      return { ok: false, done: 0, skipped: 0, failed: 0, message: 'Sélection invalide.' };
    revalidatePath('/dashboard', 'layout');
    const parts = [`${String(counts.done)} relancé${counts.done > 1 ? 's' : ''}`];
    if (counts.skipped > 0) parts.push(`${String(counts.skipped)} déjà en cours`);
    if (counts.failed > 0) parts.push(`${String(counts.failed)} en erreur`);
    return { ok: counts.failed === 0, ...counts, message: `${parts.join(', ')}.` };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { ok: false, done: 0, skipped: 0, failed: 0, message: err.message, failedIds: ids };
    }
    logger.error({ err: (err as Error).name }, 'dashboard_refresh_failed');
    return { ok: false, done: 0, skipped: 0, failed: 0, message: 'Le scanner ne répond pas.' };
  }
}

export async function deleteAuditsAction(ids: string[]): Promise<BulkResult> {
  await requireAdminMutation();
  try {
    const counts = await forEachId(ids, async (id) => {
      try {
        await deleteAudit(id);
        return 'done';
      } catch (err) {
        if (err instanceof ServiceError && err.code === 'not_found') return 'skipped';
        if (err instanceof ServiceError && err.status === 503) throw err;
        logger.warn(
          { code: err instanceof ServiceError ? err.code : 'unknown' },
          'dashboard_delete_refused',
        );
        return 'failed';
      }
    });
    if (counts === null)
      return { ok: false, done: 0, skipped: 0, failed: 0, message: 'Sélection invalide.' };
    revalidatePath('/dashboard', 'layout');
    const msg =
      counts.failed > 0
        ? `${String(counts.done)} supprimé(s), ${String(counts.failed)} en erreur.`
        : `${String(counts.done)} audit${counts.done > 1 ? 's' : ''} supprimé${counts.done > 1 ? 's' : ''}.`;
    return { ok: counts.failed === 0, ...counts, message: msg };
  } catch (err) {
    if (err instanceof ServiceError) {
      return { ok: false, done: 0, skipped: 0, failed: 0, message: err.message, failedIds: ids };
    }
    logger.error({ err: (err as Error).name }, 'dashboard_delete_failed');
    return { ok: false, done: 0, skipped: 0, failed: 0, message: 'Le scanner ne répond pas.' };
  }
}

export async function saveSettingsAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdminMutation();
  const parsed = AgencySettingsInputSchema.safeParse({
    name: form.get('name') ?? '',
    website_url: form.get('website_url') ?? '',
    contact_url: form.get('contact_url') ?? '',
    primary_color: form.get('primary_color') ?? '',
    report_footer: form.get('report_footer') ?? '',
    daily_rate_eur: form.get('daily_rate_eur') ?? '',
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const k = String(issue.path[0] ?? 'form');
      fieldErrors[k] ??= issue.message;
    }
    return { ok: false, message: 'Corrige les champs signalés.', fieldErrors };
  }
  try {
    await db().settings.save(parsed.data);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'settings_save_failed');
    return { ok: false, message: 'Enregistrement impossible pour le moment.' };
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Réglages enregistrés.' };
}

export async function uploadLogoAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireAdminMutation();
  const file = form.get('logo');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: null, fieldErrors: { logo: 'Choisis un fichier.' } };
  }
  if (file.size > 512 * 1024) {
    return { ok: false, message: null, fieldErrors: { logo: 'Le logo dépasse 512 Ko.' } };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = checkLogo(bytes);
  if (!check.ok) return { ok: false, message: null, fieldErrors: { logo: check.error } };

  const key = newBrandLogoKey(check.ext, randomBytes(12).toString('hex'));
  const media = getMediaStorage();
  try {
    await media.put(key, Buffer.from(bytes), check.contentType);
    const { previous } = await db().settings.setLogoKey(key, envBrandingDefaults());
    if (previous !== null && previous !== key) await media.delete(previous).catch(() => undefined);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'logo_upload_failed');
    await media.delete(key).catch(() => undefined);
    return { ok: false, message: 'Envoi du logo impossible pour le moment.' };
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Logo mis à jour.' };
}

export async function removeLogoAction(): Promise<FormState> {
  await requireAdminMutation();
  try {
    const { previous } = await db().settings.setLogoKey(null, envBrandingDefaults());
    if (previous !== null)
      await getMediaStorage()
        .delete(previous)
        .catch(() => undefined);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'logo_remove_failed');
    return { ok: false, message: 'Suppression impossible pour le moment.' };
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Logo retiré.' };
}

export async function logoutAction(): Promise<void> {
  await endSession();
  redirect('/login');
}
