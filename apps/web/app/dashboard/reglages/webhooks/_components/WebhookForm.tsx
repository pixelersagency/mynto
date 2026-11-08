'use client';

import {
  WEBHOOK_EVENT_LABEL,
  WEBHOOK_EVENT_TYPES,
  type WebhookSubscribableEvent,
} from '@mynto/shared';
import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useActionState } from 'react';

import { Field, INPUT_CLASS, describedBy } from '../../../_components/fields';
import { Feedback } from '../../_components/Feedback';
import { CopyField } from '../../api/ApiKeysPanel';
import { createWebhookAction, updateWebhookAction, type WebhookFormState } from '../actions';

import { DashButton } from '@/components/ui/dash-button';
import { SwitchField } from '@/components/ui/switch';

const GROUPS: { title: string; events: WebhookSubscribableEvent[] }[] = [
  {
    title: 'Audits',
    events: [
      'audit.created',
      'audit.completed',
      'audit.failed',
      'audit.refreshed',
      'audit.deleted',
    ],
  },
  { title: 'Liens de suivi', events: ['link.first_opened', 'link.opened'] },
  { title: 'Envoi par email', events: ['email.sent', 'email.failed'] },
];

const HINT: Partial<Record<WebhookSubscribableEvent, string>> = {
  'audit.completed': 'Premier scan terminé.',
  'audit.refreshed': 'Nouveau scan terminé, même lien.',
  'link.first_opened': 'Le prospect ouvre le rapport pour la première fois.',
  'link.opened': 'Chaque ouverture, dédoublonnée sur 30 minutes.',
};

export interface WebhookFormInitial {
  id?: string;
  url: string;
  description: string;
  events: WebhookSubscribableEvent[];
  active: boolean;
  legacyRadarFormat: boolean;
  managedByEnv: boolean;
}

export function WebhookForm({
  mode,
  initial,
  allowPrivate,
}: {
  mode: 'create' | 'edit';
  initial: WebhookFormInitial;
  allowPrivate: boolean;
}): React.ReactElement {
  const [state, action, pending] = useActionState<WebhookFormState, FormData>(
    mode === 'create' ? createWebhookAction : updateWebhookAction,
    { ok: false, message: null },
  );
  const errs = state.fieldErrors ?? {};

  if (mode === 'create' && state.ok && state.secret) {
    return (
      <div role="status" className="dash-note space-y-4">
        <p className="text-[14px] font-medium">{state.message}</p>
        <CopyField id="new-webhook-secret" label="Secret de signature" value={state.secret} />
        <p className="text-[12px] text-[var(--fg-muted)]">
          Colle-le dans ton outil (n8n, Make, Zapier) pour vérifier l’en-tête{' '}
          <code className="font-mono">X-Mynto-Signature</code>. Tu pourras en générer un nouveau
          plus tard, pas réafficher celui-ci.
        </p>
        <div className="flex flex-wrap gap-2">
          <DashButton asChild variant="primary">
            <Link href={`/dashboard/reglages/webhooks/${state.id ?? ''}` as '/dashboard'}>
              Ouvrir le webhook
            </Link>
          </DashButton>
          <DashButton asChild>
            <Link href="/dashboard/reglages/webhooks">Retour à la liste</Link>
          </DashButton>
        </div>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-6" noValidate>
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      {initial.managedByEnv ? <input type="hidden" name="managed" value="1" /> : null}

      <Field
        id="wh-url"
        label="Adresse"
        hint={
          initial.managedByEnv
            ? 'Vient de RADAR_WEBHOOK_URL. Change-la dans le .env puis redémarre le scanner.'
            : allowPrivate
              ? 'HTTPS conseillé. WEBHOOKS_ALLOW_PRIVATE=1 : les adresses privées et http sont acceptées.'
              : 'HTTPS obligatoire, adresse publique. Exemple : https://n8n.agence.fr/webhook/mynto'
        }
        error={errs.url}
      >
        <input
          id="wh-url"
          name="url"
          type="url"
          inputMode="url"
          defaultValue={initial.url}
          readOnly={initial.managedByEnv}
          required
          maxLength={2048}
          autoComplete="off"
          spellCheck={false}
          placeholder="https://n8n.agence.fr/webhook/mynto"
          aria-invalid={errs.url !== undefined}
          aria-describedby={describedBy('wh-url', true, errs.url)}
          className={`${INPUT_CLASS} font-mono text-[13px] read-only:bg-[var(--bg-subtle)]`}
        />
      </Field>

      <Field
        id="wh-desc"
        label="Note (facultatif)"
        hint="Pour t’y retrouver : l’outil, le scénario."
        error={errs.description}
      >
        <input
          id="wh-desc"
          name="description"
          defaultValue={initial.description}
          maxLength={120}
          autoComplete="off"
          placeholder="n8n : relance des prospects"
          aria-invalid={errs.description !== undefined}
          aria-describedby={describedBy('wh-desc', true, errs.description)}
          className={INPUT_CLASS}
        />
      </Field>

      <fieldset aria-describedby={errs.events ? 'wh-events-error' : undefined}>
        <legend className="text-[13px] font-medium">Événements</legend>
        <p className="mt-1 text-[12px] text-[var(--fg-muted)]">
          Un POST signé part à chaque événement activé.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <p className="mb-2 text-[12px] font-medium text-[var(--fg-muted)]">{g.title}</p>
              <ul className="space-y-2">
                {g.events.map((e) => (
                  <li key={e}>
                    <SwitchField
                      id={`wh-ev-${e}`}
                      name="events"
                      value={e}
                      defaultChecked={initial.events.includes(e)}
                      label={WEBHOOK_EVENT_LABEL[e]}
                      description={
                        <>
                          <code className="font-mono">{e}</code>
                          {HINT[e] ? <span className="block">{HINT[e]}</span> : null}
                        </>
                      }
                    />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        {errs.events ? (
          <p id="wh-events-error" className="mt-2 text-[12px] text-[var(--danger)]">
            {errs.events}
          </p>
        ) : null}
        <p className="sr-only">{WEBHOOK_EVENT_TYPES.length} événements disponibles.</p>
      </fieldset>

      {mode === 'edit' ? (
        <div className="space-y-3 rounded-lg border border-[var(--border)] p-4">
          <SwitchField
            id="wh-active"
            name="active"
            defaultChecked={initial.active}
            label="Actif"
            description="Le réactiver remet le compteur d’échecs à zéro."
          />
          {initial.managedByEnv ? (
            <div>
              <input type="hidden" name="legacy_present" value="1" />
              <SwitchField
                id="wh-legacy"
                name="legacy_radar_format"
                defaultChecked={initial.legacyRadarFormat}
                label="Format Radar historique"
                description={
                  <>
                    Les ouvertures partent au format <code className="font-mono">audit_viewed</code>{' '}
                    attendu par Radar. Désactive-le seulement si Radar lit le nouveau format.
                  </>
                }
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <DashButton type="submit" variant="primary" disabled={pending}>
          {mode === 'create' ? (
            <>
              <Plus className="h-4 w-4" aria-hidden="true" />{' '}
              {pending ? 'Création…' : 'Créer le webhook'}
            </>
          ) : (
            <>{pending ? 'Enregistrement…' : 'Enregistrer'}</>
          )}
        </DashButton>
        {mode === 'create' ? (
          <DashButton asChild variant="ghost">
            <Link href="/dashboard/reglages/webhooks">Annuler</Link>
          </DashButton>
        ) : null}
      </div>
      <Feedback state={state} />
    </form>
  );
}
