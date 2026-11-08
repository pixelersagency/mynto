'use server';

import { AgencySettingsInputSchema } from '@mynto/db';
import { revalidatePath } from 'next/cache';

import { requireAdminMutation } from '@/lib/auth/origin';
import { envBrandingDefaults } from '@/lib/branding';
import { db, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';

export interface WizardState {
  ok: boolean;
  message: string | null;
}

/** First-run wizard: name + color, the other brand fields are kept. */
export async function saveBrandBasicsAction(
  _prev: WizardState,
  form: FormData,
): Promise<WizardState> {
  await requireAdminMutation();
  try {
    const current = (await db().settings.get()) ?? { ...envBrandingDefaults(), logo_key: null };
    const parsed = AgencySettingsInputSchema.safeParse({
      name: form.get('name') ?? '',
      website_url: current.website_url ?? '',
      contact_url: current.contact_url ?? '',
      primary_color: form.get('primary_color') ?? '',
      report_footer: current.report_footer ?? '',
      daily_rate_eur: current.daily_rate_eur ?? '',
    });
    if (!parsed.success) {
      return { ok: false, message: parsed.error.issues[0]?.message ?? 'Valeur invalide.' };
    }
    await db().settings.save(parsed.data);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'wizard_brand_save_failed');
    return { ok: false, message: 'Enregistrement impossible pour le moment.' };
  }
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Marque enregistrée.' };
}
