'use client';

import { useActionState, useState, useTransition } from 'react';

import { Feedback } from '../_components/Feedback';
import { SettingsSection } from '../_components/SettingsSection';

import { deleteSmtpAction, saveSmtpAction, testSmtpAction, type EmailState } from './actions';

import { Field, INPUT_CLASS, describedBy } from '@/app/dashboard/_components/fields';
import { DashButton } from '@/components/ui/dash-button';
import { SwitchField } from '@/components/ui/switch';

const INITIAL: EmailState = { ok: false, message: null };

interface Initial {
  host: string;
  port: string;
  security: string;
  username: string;
  from_name: string;
  from_email: string;
  reply_to: string;
  subject_template: string;
  body_template: string;
}

export function SmtpForm({
  initial,
  passwordHint,
  configured,
}: {
  initial: Initial;
  passwordHint: string | null;
  configured: boolean;
}): React.ReactElement {
  const [state, action, pending] = useActionState(saveSmtpAction, INITIAL);
  const [removed, setRemoved] = useState<EmailState>(INITIAL);
  const [removing, start] = useTransition();
  const err = state.fieldErrors ?? {};
  const input = (
    name: keyof Initial,
    label: string,
    opts: { type?: string; hint?: string; autoComplete?: string; required?: boolean } = {},
  ): React.ReactElement => (
    <Field id={`smtp-${name}`} label={label} hint={opts.hint} error={err[name]}>
      <input
        id={`smtp-${name}`}
        name={name}
        type={opts.type ?? 'text'}
        required={opts.required}
        defaultValue={initial[name]}
        autoComplete={opts.autoComplete ?? 'off'}
        aria-invalid={err[name] ? true : undefined}
        aria-describedby={describedBy(`smtp-${name}`, Boolean(opts.hint), err[name])}
        className={INPUT_CLASS}
      />
    </Field>
  );
  return (
    <form action={action}>
      <SettingsSection
        id="smtp-server"
        title="Serveur"
        description="Celui de ta messagerie. Le mot de passe est chiffré en base."
      >
        <div className="grid gap-4 sm:grid-cols-[1fr_120px_160px]">
          {input('host', 'Hôte', { required: true, hint: 'Par exemple smtp.ton-domaine.fr' })}
          {input('port', 'Port', { type: 'number', required: true })}
          <Field id="smtp-security" label="Sécurité" error={err.security}>
            <select
              id="smtp-security"
              name="security"
              defaultValue={initial.security}
              className={INPUT_CLASS}
            >
              <option value="starttls">STARTTLS (587)</option>
              <option value="tls">TLS (465)</option>
              <option value="none">Aucune</option>
            </select>
          </Field>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {input('username', 'Identifiant', { autoComplete: 'username' })}
          <Field
            id="smtp-password"
            label="Mot de passe"
            hint={
              passwordHint
                ? `Enregistré (${passwordHint}). Laisse vide pour le garder.`
                : 'Chiffré avant d’être enregistré.'
            }
            error={err.password}
          >
            <input
              id="smtp-password"
              name="password"
              type="password"
              autoComplete="new-password"
              aria-describedby={describedBy('smtp-password', true, err.password)}
              className={INPUT_CLASS}
            />
          </Field>
        </div>
        {passwordHint ? (
          <SwitchField
            id="smtp-clear-password"
            name="clear_password"
            className="mt-3"
            label="Supprimer le mot de passe enregistré"
          />
        ) : null}
      </SettingsSection>

      <SettingsSection
        id="smtp-sender"
        title="Expéditeur"
        description="Ce que le prospect voit dans sa boîte de réception."
      >
        <div className="grid gap-4 sm:grid-cols-3">
          {input('from_name', 'Nom', { required: true })}
          {input('from_email', 'Adresse', { type: 'email', required: true })}
          {input('reply_to', 'Répondre à', { type: 'email', hint: 'Optionnel' })}
        </div>
      </SettingsSection>

      <SettingsSection
        id="smtp-template"
        title="Message par défaut"
        description={
          <>
            Modifiable à chaque envoi. Variables : <code>{'{site}'}</code>, <code>{'{score}'}</code>
            , <code>{'{lien}'}</code> (lien de suivi), <code>{'{agence}'}</code>. Garde une phrase
            pour ne plus être contacté : c’est de la prospection.
          </>
        }
      >
        <div className="space-y-4">
          {input('subject_template', 'Objet', { required: true })}
          <Field id="smtp-body_template" label="Message" error={err.body_template}>
            <textarea
              id="smtp-body_template"
              name="body_template"
              required
              rows={12}
              maxLength={5000}
              defaultValue={initial.body_template}
              className={`${INPUT_CLASS} h-auto py-2 leading-relaxed`}
            />
          </Field>
        </div>
      </SettingsSection>

      <div className="flex flex-wrap items-center gap-3 pb-8 lg:pl-[240px]">
        <DashButton type="submit" variant="primary" disabled={pending}>
          Enregistrer
        </DashButton>
        {configured ? (
          <DashButton
            type="button"
            variant="ghost"
            disabled={removing}
            onClick={() => {
              start(async () => {
                setRemoved(await deleteSmtpAction());
              });
            }}
          >
            Supprimer la configuration
          </DashButton>
        ) : null}
        <Feedback state={state.message ? state : removed} />
      </div>
    </form>
  );
}

export function TestForm({ defaultTo }: { defaultTo: string }): React.ReactElement {
  const [state, action, pending] = useActionState(testSmtpAction, INITIAL);
  return (
    <SettingsSection
      id="smtp-test"
      title="Email de test"
      description="Vérifie la configuration avant le premier envoi à un prospect."
    >
      <form action={action} className="flex flex-wrap items-end gap-3">
        <div className="min-w-[240px] flex-1">
          <label htmlFor="smtp-test-to" className="text-[13px] font-medium">
            Destinataire
          </label>
          <input
            id="smtp-test-to"
            name="to"
            type="email"
            defaultValue={defaultTo}
            className={`${INPUT_CLASS} mt-1.5`}
          />
        </div>
        <DashButton type="submit" disabled={pending}>
          {pending ? 'Envoi…' : 'Envoyer le test'}
        </DashButton>
        <div className="basis-full">
          <Feedback state={state} />
        </div>
      </form>
    </SettingsSection>
  );
}
