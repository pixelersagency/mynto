'use server';

import { fillEmailTemplate } from '@mynto/db';
import { resolveTemplateAlias } from '@mynto/templates';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { requireAdminMutation } from '@/lib/auth/origin';
import { getBranding } from '@/lib/branding';
import { reportUrl } from '@/lib/dashboard/format';
import { db, pgErrorCode } from '@/lib/db';
import { SMTP_ERROR_MESSAGE, SmtpError, sendMail, textToHtml } from '@/lib/email/smtp';
import { publicUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { loadTemplateBundle } from '@/lib/reports/templates';
import { hostOf, score100 } from '@/lib/scores';
import { ServiceError, createAudit } from '@/lib/services/audits';

/**
 * Mutations of the audit record (side panel), the command palette and the
 * home quick launch. Each one starts with requireAdminMutation (session +
 * same origin) and validates its input with Zod.
 */

export interface ActionResult {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
}

const SEND_LIMIT_PER_HOUR = 60;

const SendSchema = z.object({
  auditId: z.string().uuid(),
  recipient: z
    .string()
    .trim()
    .max(254)
    .regex(/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/, 'Adresse email invalide'),
  subject: z.string().trim().min(1, 'Indique un objet').max(200),
  body: z.string().trim().min(1, 'Indique un message').max(5000),
});

export async function sendReportAction(input: unknown): Promise<ActionResult> {
  await requireAdminMutation();
  const parsed = SendSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, message: 'Corrige les champs signalés.', fieldErrors };
  }
  const v = parsed.data;
  try {
    const { rows } = await db().dashboard.listAudits({ ids: [v.auditId], limit: 1 });
    const row = rows[0];
    if (row?.status !== 'completed') {
      return { ok: false, message: 'Seul un audit terminé peut être envoyé.' };
    }
    if ((await db().email.countRecent(60)) >= SEND_LIMIT_PER_HOUR) {
      return { ok: false, message: 'Trop d’envois en une heure. Réessaye plus tard.' };
    }
    const smtp = await db().email.getSmtpSecret();
    const brand = await getBranding();
    const link = reportUrl(publicUrl(), { tracking_token: row.tracking_token, slug: row.slug });
    // {lien} must survive an edited body: the tracking link is what gets sent.
    const vars = {
      site: hostOf(row.url),
      score: String(score100(row.global_score) ?? '-'),
      lien: link,
      agence: brand.name,
    };
    const subject = fillEmailTemplate(v.subject, vars).replace(/[\r\n]+/g, ' ');
    let text = fillEmailTemplate(v.body, vars);
    if (!text.includes(link)) text = `${text}\n\n${link}`;
    try {
      await sendMail(smtp, { to: v.recipient, subject, text, html: textToHtml(text) });
    } catch (err) {
      const code = err instanceof SmtpError ? err.code : 'unknown';
      if (code !== 'not_configured') {
        await db()
          .email.logSend({
            auditId: row.id,
            recipient: v.recipient,
            subject,
            status: 'failed',
            errorCode: code,
          })
          .catch(() => undefined);
      }
      logger.warn({ code }, 'report_email_failed');
      revalidatePath(`/dashboard/audits/${row.id}`);
      return { ok: false, message: SMTP_ERROR_MESSAGE[code] };
    }
    await db().email.logSend({ auditId: row.id, recipient: v.recipient, subject, status: 'sent' });
    logger.info('report_email_sent');
    revalidatePath(`/dashboard/audits/${row.id}`);
    return { ok: true, message: 'Rapport envoyé.' };
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'report_email_error');
    return { ok: false, message: 'Envoi impossible pour le moment.' };
  }
}

const TemplateSchema = z.object({
  auditId: z.string().uuid(),
  // Retired built-in ids (standard, compact, commercial) are stored under their replacement.
  templateId: z.union([
    z.literal(''),
    z
      .string()
      .regex(/^[a-z][a-z0-9-]{1,39}$/)
      .transform(resolveTemplateAlias),
  ]),
});

/** Changes the report template of an audit ('' = install default). */
export async function setAuditTemplateAction(input: unknown): Promise<ActionResult> {
  await requireAdminMutation();
  const parsed = TemplateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: 'Modèle invalide.' };
  const { auditId, templateId } = parsed.data;
  if (templateId !== '' && (await loadTemplateBundle(templateId)) === null) {
    return { ok: false, message: 'Ce modèle n’existe plus.' };
  }
  try {
    await db().reports.setAuditTemplate(auditId, templateId === '' ? null : templateId);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'audit_template_save_failed');
    return { ok: false, message: 'Enregistrement impossible pour le moment.' };
  }
  revalidatePath(`/dashboard/audits/${auditId}`);
  return { ok: true, message: 'Modèle du rapport mis à jour.' };
}

const QuickSchema = z.object({
  url: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .refine((v) => {
      try {
        const u = new URL(v);
        return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
      } catch {
        return false;
      }
    }, 'Cette adresse ne ressemble pas à un site web.'),
});

/** Launches an audit with the install defaults (⌘K, home). */
export async function quickAuditAction(input: unknown): Promise<ActionResult & { id?: string }> {
  await requireAdminMutation();
  const parsed = QuickSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? 'Adresse invalide.' };
  }
  try {
    const audit = await createAudit({ url: parsed.data.url }, 'dashboard');
    revalidatePath('/dashboard', 'layout');
    return { ok: true, message: 'Audit lancé.', id: audit.id };
  } catch (err) {
    if (err instanceof ServiceError) return { ok: false, message: err.message };
    logger.error({ err: (err as Error).name }, 'quick_audit_failed');
    return { ok: false, message: 'Le scanner n’a pas pu lancer l’audit.' };
  }
}

export interface SearchHit {
  id: string;
  name: string;
  host: string;
  status: string;
  score: number | null;
  faviconUrl: string | null;
}

/** Audit search of the command palette (URL or label). */
export async function searchAuditsAction(q: unknown): Promise<SearchHit[]> {
  await requireAdminMutation();
  const parsed = z.string().trim().min(1).max(200).safeParse(q);
  if (!parsed.success) return [];
  try {
    const { rows } = await db().dashboard.listAudits({ q: parsed.data, limit: 8 });
    return rows.map((r) => ({
      id: r.id,
      name: r.label ?? hostOf(r.url),
      host: hostOf(r.url),
      status: r.status,
      score: score100(r.global_score),
      faviconUrl: r.favicon_key ? `/media/${r.favicon_key}` : null,
    }));
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'palette_search_failed');
    return [];
  }
}
