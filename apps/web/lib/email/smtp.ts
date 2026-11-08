import 'server-only';

import {
  DecryptionError,
  EncryptionKeyInvalidError,
  EncryptionKeyMissingError,
  SMTP_PASSWORD_AAD,
  decryptSecret,
  type SmtpSettingsSecret,
} from '@mynto/db';
import nodemailer from 'nodemailer';

import { getServerEnv } from '@/lib/env';

/**
 * Sends mail through the agency's own SMTP server (nodemailer, server-side
 * only). The password is decrypted at send time and never leaves this
 * module; errors are mapped to short codes before they reach a log or the UI.
 */

export type SmtpErrorCode =
  | 'not_configured'
  | 'key_missing'
  | 'key_invalid'
  | 'auth'
  | 'connection'
  | 'tls'
  | 'rejected'
  | 'timeout'
  | 'unknown';

export class SmtpError extends Error {
  readonly code: SmtpErrorCode;
  constructor(code: SmtpErrorCode) {
    super(code);
    this.name = 'SmtpError';
    this.code = code;
  }
}

export const SMTP_ERROR_MESSAGE: Record<SmtpErrorCode, string> = {
  not_configured: 'Le serveur SMTP n’est pas configuré (Réglages > Email).',
  key_missing: 'APP_ENCRYPTION_KEY manque : le mot de passe SMTP ne peut pas être déchiffré.',
  key_invalid: 'Le mot de passe SMTP ne se déchiffre plus (clé changée). Saisis-le à nouveau.',
  auth: 'Le serveur SMTP refuse l’identifiant ou le mot de passe.',
  connection: 'Impossible de joindre le serveur SMTP. Vérifie l’hôte et le port.',
  tls: 'Échec de la connexion chiffrée. Essaie l’autre mode de sécurité (TLS ou STARTTLS).',
  rejected: 'Le serveur SMTP a refusé le message ou le destinataire.',
  timeout: 'Le serveur SMTP ne répond pas à temps.',
  unknown: 'Envoi impossible pour le moment.',
};

function mapError(err: unknown): SmtpErrorCode {
  const e = err as { code?: string; responseCode?: number; command?: string } | null;
  const code = e?.code ?? '';
  if (code === 'EAUTH' || e?.responseCode === 535) return 'auth';
  if (code === 'ETIMEDOUT' || code === 'ETIMEOUT') return 'timeout';
  if (code === 'ETLS' || (code === 'ESOCKET' && /tls|ssl/i.test((err as Error).message)))
    return 'tls';
  if (code === 'ECONNECTION' || code === 'ECONNREFUSED' || code === 'EDNS' || code === 'ESOCKET') {
    return 'connection';
  }
  if (code === 'EENVELOPE' || code === 'EMESSAGE' || (e?.responseCode ?? 0) >= 500)
    return 'rejected';
  return 'unknown';
}

function password(smtp: SmtpSettingsSecret): string | undefined {
  if (smtp.password_ciphertext === null) return undefined;
  try {
    return decryptSecret(
      smtp.password_ciphertext,
      getServerEnv().APP_ENCRYPTION_KEY,
      SMTP_PASSWORD_AAD,
    );
  } catch (err) {
    if (err instanceof EncryptionKeyMissingError) throw new SmtpError('key_missing');
    if (err instanceof EncryptionKeyInvalidError || err instanceof DecryptionError) {
      throw new SmtpError('key_invalid');
    }
    throw new SmtpError('unknown');
  }
}

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(smtp: SmtpSettingsSecret | null, mail: OutgoingMail): Promise<void> {
  if (smtp === null) throw new SmtpError('not_configured');
  const pass = password(smtp);
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls',
    ignoreTLS: smtp.security === 'none',
    auth: smtp.username ? { user: smtp.username, pass: pass ?? '' } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
    // Never log the transcript (it carries credentials).
    logger: false,
    debug: false,
  });
  try {
    await transport.sendMail({
      from: { name: smtp.from_name, address: smtp.from_email },
      ...(smtp.reply_to ? { replyTo: smtp.reply_to } : {}),
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
    });
  } catch (err) {
    throw new SmtpError(mapError(err));
  } finally {
    transport.close();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${String(c.charCodeAt(0))};`);
}

/** Plain HTML version of a text body: paragraphs, links made clickable. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const safe = escapeHtml(para).replace(/\n/g, '<br>');
      return `<p>${safe.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`;
    })
    .join('\n');
}
