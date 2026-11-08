'use client';

import { useActionState, useState, useTransition } from 'react';

import { Field, INPUT_CLASS, describedBy } from '../../_components/fields';
import { Feedback } from '../_components/Feedback';
import {
  deleteAiKeyAction,
  saveAiKeyAction,
  saveAiSettingsAction,
  testAiConnectionAction,
  type SettingsState,
} from '../actions';

import { DashButton } from '@/components/ui/dash-button';
import { RadioGroup } from '@/components/ui/radio-group';

export type Provider = 'anthropic' | 'gemini' | 'mistral';

export const PROVIDER_LABEL: Record<Provider, string> = {
  anthropic: 'Anthropic (Claude)',
  gemini: 'Google Gemini',
  mistral: 'Mistral',
};

export interface ProviderSettingsValues {
  narrative_provider: Provider;
  vision_provider: 'anthropic' | 'gemini';
  models: Record<string, string>;
  defaults: Record<string, string>;
}

export function ProviderSettingsForm({
  initial,
}: {
  initial: ProviderSettingsValues;
}): React.ReactElement {
  const [state, action, pending] = useActionState<SettingsState, FormData>(saveAiSettingsAction, {
    ok: false,
    message: null,
  });
  const err = state.fieldErrors ?? {};
  const model = (name: string, label: string): React.ReactElement => (
    <Field
      id={name}
      label={label}
      hint={`Vide = ${initial.defaults[name] ?? 'par défaut'}`}
      error={err[name]}
    >
      <input
        id={name}
        name={name}
        defaultValue={initial.models[name] ?? ''}
        placeholder={initial.defaults[name]}
        maxLength={100}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={err[name] !== undefined}
        aria-describedby={describedBy(name, true, err[name])}
        className={`${INPUT_CLASS} font-mono text-[13px]`}
      />
    </Field>
  );
  return (
    <form action={action} className="space-y-6" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <RadioGroup
          variant="segmented"
          name="narrative_provider"
          legend="Rédaction du rapport"
          hint="Synthèse, priorités, recommandations. Anthropic par défaut."
          defaultValue={initial.narrative_provider}
          options={[
            { value: 'anthropic', label: 'Anthropic' },
            { value: 'gemini', label: 'Gemini' },
            { value: 'mistral', label: 'Mistral' },
          ]}
        />
        <RadioGroup
          variant="segmented"
          name="vision_provider"
          legend="Analyse visuelle"
          hint="Lecture de la capture d’écran. Anthropic par défaut."
          defaultValue={initial.vision_provider}
          options={[
            { value: 'anthropic', label: 'Anthropic' },
            { value: 'gemini', label: 'Gemini' },
          ]}
        />
      </div>
      <fieldset className="space-y-4">
        <legend className="text-[13px] font-medium">Modèles</legend>
        <p className="text-[12px] text-[var(--fg-muted)]">
          Identifiant exact du fournisseur. Laisse vide pour garder le modèle par défaut.
        </p>
        <div className="grid gap-5 sm:grid-cols-2">
          {model('model_anthropic_narrative', 'Anthropic, rédaction')}
          {model('model_anthropic_vision', 'Anthropic, analyse visuelle')}
          {model('model_gemini_narrative', 'Gemini, rédaction')}
          {model('model_gemini_vision', 'Gemini, analyse visuelle')}
          {model('model_mistral_narrative', 'Mistral, rédaction')}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <DashButton type="submit" variant="primary" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </DashButton>
        <Feedback state={state} />
      </div>
    </form>
  );
}

export interface KeyInfo {
  provider: Provider;
  hint: string | null;
  updatedLabel: string | null;
  envFallback: boolean;
  /** Purpose tested by "Tester la connexion" (the one this provider serves). */
  purpose: 'narrative' | 'vision';
  inUse: string | null;
}

export function ProviderKeyCard({
  info,
  canSave,
}: {
  info: KeyInfo;
  canSave: boolean;
}): React.ReactElement {
  const [editing, setEditing] = useState(info.hint === null);
  const [state, action, pending] = useActionState<SettingsState, FormData>(
    async (prev, form) => {
      const res = await saveAiKeyAction(prev, form);
      if (res.ok) setEditing(false);
      return res;
    },
    { ok: false, message: null },
  );
  const [result, setResult] = useState<SettingsState>({ ok: false, message: null });
  const [busy, start] = useTransition();
  const inputId = `key-${info.provider}`;
  const err = state.fieldErrors?.api_key;

  return (
    <section aria-labelledby={`${inputId}-title`} className="py-5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`${inputId}-title`} className="text-[14px] font-medium">
            {PROVIDER_LABEL[info.provider]}
          </h3>
          <p className="mt-0.5 text-[12px] text-[var(--fg-muted)]">
            {info.inUse ?? 'Pas utilisé avec les réglages actuels.'}
          </p>
        </div>
        <p className="flex items-center gap-1.5 text-[13px]">
          {info.hint !== null ? (
            <>
              <span className="sr-only">Clé enregistrée : </span>
              <code className="rounded bg-[var(--bg-subtle)] px-1.5 py-0.5 font-mono text-[12px]">
                {info.hint}
              </code>
            </>
          ) : info.envFallback ? (
            <span className="text-[var(--fg-muted)]">Clé d’environnement</span>
          ) : (
            <span className="text-[var(--fg-muted)]">Aucune clé</span>
          )}
        </p>
      </div>
      {info.updatedLabel ? (
        <p className="mt-1 text-[12px] text-[var(--fg-muted)]">
          Enregistrée le {info.updatedLabel}
        </p>
      ) : null}

      {editing ? (
        <form action={action} className="mt-4 space-y-3" noValidate>
          <input type="hidden" name="provider" value={info.provider} />
          <Field
            id={inputId}
            label={info.hint !== null ? 'Nouvelle clé' : 'Clé API'}
            hint="Chiffrée avant d’être enregistrée. Elle ne sera plus jamais affichée en entier."
            error={err}
          >
            <input
              id={inputId}
              name="api_key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
              disabled={!canSave}
              aria-invalid={err !== undefined}
              aria-describedby={describedBy(inputId, true, err)}
              className={`${INPUT_CLASS} font-mono text-[13px]`}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <DashButton type="submit" variant="primary" size="sm" disabled={pending || !canSave}>
              {pending ? 'Chiffrement…' : 'Enregistrer la clé'}
            </DashButton>
            {info.hint !== null ? (
              <DashButton
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                }}
              >
                Annuler
              </DashButton>
            ) : null}
          </div>
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <DashButton
            size="sm"
            onClick={() => {
              setEditing(true);
            }}
            disabled={!canSave}
          >
            Remplacer
          </DashButton>
          <DashButton
            size="sm"
            className="text-[var(--danger)]"
            disabled={busy}
            onClick={() => {
              start(async () => {
                const res = await deleteAiKeyAction(info.provider);
                setResult(res);
                if (res.ok) setEditing(true);
              });
            }}
          >
            Supprimer
          </DashButton>
        </div>
      )}

      {info.hint !== null || info.envFallback ? (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <DashButton
            size="sm"
            disabled={busy}
            onClick={() => {
              setResult({ ok: false, message: null });
              start(async () => {
                setResult(await testAiConnectionAction(info.provider, info.purpose));
              });
            }}
          >
            {busy ? 'Test…' : 'Tester la connexion'}
          </DashButton>
          <Feedback state={result} />
        </div>
      ) : null}
      <Feedback state={state.fieldErrors ? { ok: false, message: null } : state} />
    </section>
  );
}
