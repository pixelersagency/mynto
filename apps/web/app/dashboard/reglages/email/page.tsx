import { DEFAULT_EMAIL_BODY, DEFAULT_EMAIL_SUBJECT, hasValidMasterKey } from '@mynto/db';
import type { Metadata } from 'next';

import { Topbar } from '../../_components/Topbar';
import { SettingsNav } from '../_components/SettingsNav';

import { SmtpForm, TestForm } from './EmailForms';

import { requireAdmin } from '@/lib/auth/admin';
import { db } from '@/lib/db';
import { getServerEnv } from '@/lib/env';

export const metadata: Metadata = { title: 'Email' };

export default async function EmailSettingsPage(): Promise<React.ReactElement> {
  const session = await requireAdmin();
  const smtp = await db().email.getSmtp();
  const keyOk = hasValidMasterKey(getServerEnv().APP_ENCRYPTION_KEY);
  return (
    <>
      <Topbar
        crumbs={[
          {
            label: 'Réglages',
            href: '/dashboard/reglages',
          },
          { label: 'Email' },
        ]}
      />
      <SettingsNav active="email" />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-8">
            <h1 className="dash-display">Envoi des rapports par email</h1>
            <p className="mt-1 max-w-2xl text-[13px] text-[var(--fg-muted)]">
              Les rapports partent de ton propre serveur SMTP, avec ton adresse. Le lien envoyé est
              le lien de suivi. Sans SMTP, l’action « Envoyer le rapport » reste grisée.
            </p>
            {!keyOk ? (
              <p role="alert" className="dash-note dash-note--warning mt-3">
                APP_ENCRYPTION_KEY n’est pas définie : tu peux enregistrer un serveur sans mot de
                passe, pas un mot de passe. Génère-la avec « openssl rand -base64 32 ».
              </p>
            ) : null}
          </div>
          <SmtpForm
            initial={{
              host: smtp?.host ?? '',
              port: String(smtp?.port ?? 587),
              security: smtp?.security ?? 'starttls',
              username: smtp?.username ?? '',
              from_name: smtp?.from_name ?? '',
              from_email: smtp?.from_email ?? '',
              reply_to: smtp?.reply_to ?? '',
              subject_template: smtp?.subject_template ?? DEFAULT_EMAIL_SUBJECT,
              body_template: smtp?.body_template ?? DEFAULT_EMAIL_BODY,
            }}
            passwordHint={smtp?.has_password ? smtp.password_hint : null}
            configured={smtp !== null}
          />
          {smtp !== null ? <TestForm defaultTo={session.email} /> : null}
        </div>
      </main>
    </>
  );
}
