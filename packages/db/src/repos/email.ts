import { z } from 'zod';

import type { Sql } from '../client.js';

import { emitWebhookEvent } from './webhooks.js';

/**
 * Agency SMTP settings (single row) and the "Envoyer le rapport" log.
 * The SMTP password reaches this repository already encrypted
 * (encryptSecret, AAD "smtp"); reads for the dashboard never select it.
 */

export const SMTP_PASSWORD_AAD = 'smtp';

export const DEFAULT_EMAIL_SUBJECT = 'Audit de {site} : {score}/100';
export const DEFAULT_EMAIL_BODY = `Bonjour,

J’ai réalisé un audit de {site}. Score global : {score}/100.

Le rapport complet, avec les priorités et un chiffrage indicatif :
{lien}

Je reste disponible pour en parler.

{agence}

Tu reçois ce message parce que nous avons audité ton site. Réponds « stop » et nous ne te recontacterons plus.`;

const EMAIL = z
  .string()
  .trim()
  .max(254)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Adresse email invalide');

const optional = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), s.nullable());

/** Editable SMTP fields (the password is handled apart). */
export const SmtpSettingsInputSchema = z.object({
  host: z
    .string()
    .trim()
    .min(1, 'Indique l’hôte SMTP')
    .max(253)
    .regex(/^[A-Za-z0-9.-]+$/, 'Hôte invalide'),
  port: z.coerce.number().int().min(1, 'Port invalide').max(65535, 'Port invalide'),
  security: z.enum(['tls', 'starttls', 'none']),
  username: optional(z.string().trim().max(254)),
  from_name: z.string().trim().min(1, 'Indique un nom d’expéditeur').max(80),
  from_email: EMAIL,
  reply_to: optional(EMAIL),
  subject_template: z.string().trim().min(1, 'Indique un objet').max(200),
  body_template: z.string().trim().min(1, 'Indique un message').max(5000),
});
export type SmtpSettingsInput = z.infer<typeof SmtpSettingsInputSchema>;

/** What the dashboard reads: never the ciphertext. */
export interface SmtpSettingsPublic extends SmtpSettingsInput {
  has_password: boolean;
  password_hint: string | null;
  updated_at: string;
}

export interface SmtpSettingsSecret extends SmtpSettingsPublic {
  password_ciphertext: string | null;
}

export interface EmailSendRow {
  id: string;
  audit_id: string;
  recipient: string;
  subject: string;
  status: 'sent' | 'failed';
  error_code: string | null;
  created_at: string;
}

export function createEmailRepo(sql: Sql) {
  return {
    async getSmtp(): Promise<SmtpSettingsPublic | null> {
      const [row] = await sql<SmtpSettingsPublic[]>`
        select host, port, security, username, from_name, from_email, reply_to,
               subject_template, body_template, password_hint, updated_at,
               (password_ciphertext is not null) as has_password
          from smtp_settings where id
      `;
      return row ?? null;
    },

    /** Server-side send path only. */
    async getSmtpSecret(): Promise<SmtpSettingsSecret | null> {
      const [row] = await sql<SmtpSettingsSecret[]>`
        select host, port, security, username, from_name, from_email, reply_to,
               subject_template, body_template, password_hint, updated_at, password_ciphertext,
               (password_ciphertext is not null) as has_password
          from smtp_settings where id
      `;
      return row ?? null;
    },

    /**
     * Saves the SMTP settings. `password`: undefined keeps the stored one,
     * null removes it, an object replaces it (already encrypted).
     */
    async saveSmtp(
      input: SmtpSettingsInput,
      password?: { ciphertext: string; hint: string } | null,
    ): Promise<void> {
      const v = SmtpSettingsInputSchema.parse(input);
      const keep = password === undefined;
      const cipher = password?.ciphertext ?? null;
      const hint = password?.hint ?? null;
      await sql`
        insert into smtp_settings (id, host, port, security, username, from_name, from_email,
          reply_to, subject_template, body_template, password_ciphertext, password_hint)
        values (true, ${v.host}, ${v.port}, ${v.security}, ${v.username}, ${v.from_name},
          ${v.from_email}, ${v.reply_to}, ${v.subject_template}, ${v.body_template},
          ${cipher}, ${hint})
        on conflict (id) do update set
          host = excluded.host, port = excluded.port, security = excluded.security,
          username = excluded.username, from_name = excluded.from_name,
          from_email = excluded.from_email, reply_to = excluded.reply_to,
          subject_template = excluded.subject_template, body_template = excluded.body_template,
          password_ciphertext = case when ${keep} then smtp_settings.password_ciphertext
                                     else excluded.password_ciphertext end,
          password_hint = case when ${keep} then smtp_settings.password_hint
                               else excluded.password_hint end,
          updated_at = now()
      `;
    },

    async deleteSmtp(): Promise<void> {
      await sql`delete from smtp_settings where id`;
    },

    async logSend(input: {
      auditId: string;
      recipient: string;
      subject: string;
      status: 'sent' | 'failed';
      errorCode?: string | null;
    }): Promise<void> {
      const recipient = input.recipient.slice(0, 254);
      const subject = input.subject.slice(0, 200);
      const errorCode = input.errorCode?.slice(0, 64) ?? null;
      await sql.begin(async (tx) => {
        await tx`
          insert into email_sends (audit_id, recipient, subject, status, error_code)
          values (${input.auditId}, ${recipient}, ${subject}, ${input.status}, ${errorCode})
        `;
        // email.* is the only event that carries an address: the one the agency typed.
        await emitWebhookEvent(tx, {
          type: input.status === 'sent' ? 'email.sent' : 'email.failed',
          auditId: input.auditId,
          email: { recipient, subject, status: input.status, error_code: errorCode },
        });
      });
    },

    /** Sends of an audit and of the scans it replaced, newest first. */
    async listSends(auditId: string, limit = 20): Promise<EmailSendRow[]> {
      return sql<EmailSendRow[]>`
        with recursive chain as (
          select id from audits_full where id = ${auditId}
          union all
          select a.id from audits_full a join chain c on a.replaced_by = c.id
        )
        select id, audit_id, recipient, subject, status, error_code, created_at
          from email_sends where audit_id in (select id from chain)
         order by created_at desc limit ${Math.min(Math.max(limit, 1), 100)}
      `;
    },

    /** Sends in the last `minutes` (rate limit of the send action). */
    async countRecent(minutes: number): Promise<number> {
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from email_sends
         where created_at > now() - make_interval(mins => ${minutes})
      `;
      return row?.n ?? 0;
    },
  };
}

export type EmailRepo = ReturnType<typeof createEmailRepo>;

/** Replaces {site} {score} {lien} {agence} in a subject or body template. */
export function fillEmailTemplate(
  template: string,
  vars: { site: string; score: string; lien: string; agence: string },
): string {
  return template.replace(/\{(site|score|lien|agence)\}/g, (_m, k: keyof typeof vars) => vars[k]);
}
