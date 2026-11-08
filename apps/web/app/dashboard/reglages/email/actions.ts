'use server';

import {
  SMTP_PASSWORD_AAD,
  SmtpSettingsInputSchema,
  encryptSecret,
  hasValidMasterKey,
  maskSecret,
} from '@mynto/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdminMutation } from '@/lib/auth/origin';
import { getBranding } from '@/lib/branding';
import { db, pgErrorCode } from '@/lib/db';
import { SMTP_ERROR_MESSAGE, SmtpError, sendMail } from '@/lib/email/smtp';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

export interface EmailState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

/** Saves the SMTP settings. The password is encrypted here and never echoed back. */
export async function saveSmtpAction(_prev: EmailState, form: FormData): Promise<EmailState> {
  await requireAdminMutation();
  const parsed = SmtpSettingsInputSchema.safeParse({
    host: form.get('host') ?? '',
    port: form.get('port') ?? '',
    security: form.get('security') ?? '',
    username: form.get('username') ?? '',
    from_name: form.get('from_name') ?? '',
    from_email: form.get('from_email') ?? '',
    reply_to: form.get('reply_to') ?? '',
    subject_template: form.get('subject_template') ?? '',
    body_template: form.get('body_template') ?? '',
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, message: 'Corrige les champs signalés.', fieldErrors };
  }
  const rawPassword = form.get('password');
  const clear = form.get('clear_password') === 'on';
  let password: { ciphertext: string; hint: string } | null | undefined;
  if (clear) password = null;
  else if (typeof rawPassword === 'string' && rawPassword.length > 0) {
    if (rawPassword.length > 500)
      return { ok: false, message: null, fieldErrors: { password: 'Mot de passe trop long.' } };
    const master = getServerEnv().APP_ENCRYPTION_KEY;
    if (!hasValidMasterKey(master)) {
      return {
        ok: false,
        message:
          'APP_ENCRYPTION_KEY manque ou est invalide : le mot de passe ne peut pas être chiffré.',
      };
    }
    password = {
      ciphertext: encryptSecret(rawPassword, master, SMTP_PASSWORD_AAD),
      hint: maskSecret(rawPassword).slice(-5),
    };
  }
  try {
    await db().email.saveSmtp(parsed.data, password);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'smtp_save_failed');
    return { ok: false, message: 'Enregistrement impossible pour le moment.' };
  }
  revalidatePath('/dashboard', 'layout');
  return { ok: true, message: 'Réglages email enregistrés.' };
}

function pickRecipient(raw: FormDataEntryValue | null, fallback: string): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return v.length > 0 ? v : fallback;
}

export async function testSmtpAction(_prev: EmailState, form: FormData): Promise<EmailState> {
  const session = await requireAdminMutation();
  const to = z
    .string()
    .trim()
    .max(254)
    .regex(/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/)
    .safeParse(pickRecipient(form.get('to'), session.email));
  if (!to.success) return { ok: false, message: 'Adresse de test invalide.' };
  try {
    const brand = await getBranding();
    await sendMail(await db().email.getSmtpSecret(), {
      to: to.data,
      subject: `Test d’envoi de ${brand.name}`,
      text: `Ton serveur SMTP fonctionne. Les rapports partiront avec ces réglages.\n\n${brand.name}`,
    });
  } catch (err) {
    const code = err instanceof SmtpError ? err.code : 'unknown';
    logger.warn({ code }, 'smtp_test_failed');
    return { ok: false, message: SMTP_ERROR_MESSAGE[code] };
  }
  return { ok: true, message: `Email de test envoyé à ${to.data}.` };
}

export async function deleteSmtpAction(): Promise<EmailState> {
  await requireAdminMutation();
  try {
    await db().email.deleteSmtp();
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'smtp_delete_failed');
    return { ok: false, message: 'Suppression impossible pour le moment.' };
  }
  revalidatePath('/dashboard', 'layout');
  return { ok: true, message: 'Réglages email supprimés. L’envoi est désactivé.' };
}
