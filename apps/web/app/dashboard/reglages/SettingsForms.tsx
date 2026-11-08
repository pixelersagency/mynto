'use client';

import { useActionState, useState, useTransition } from 'react';

import { Field, INPUT_CLASS, describedBy } from '../_components/fields';
import { removeLogoAction, saveSettingsAction, uploadLogoAction, type FormState } from '../actions';

import { AgencyMark } from '@/components/agency-mark';
import { DashButton } from '@/components/ui/dash-button';

export interface SettingsValues {
  name: string;
  website_url: string;
  contact_url: string;
  primary_color: string;
  report_footer: string;
  daily_rate_eur: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function Feedback({ state }: { state: FormState }): React.ReactElement {
  return (
    <div aria-live="polite" className="min-h-5">
      {state.message ? (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={`text-[13px] ${state.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}

export function BrandForm({
  initial,
  defaultColor,
}: {
  initial: SettingsValues;
  defaultColor: string;
}): React.ReactElement {
  const [state, action, pending] = useActionState<FormState, FormData>(saveSettingsAction, {
    ok: false,
    message: null,
  });
  const [color, setColor] = useState(initial.primary_color);
  const err = state.fieldErrors ?? {};
  const swatch = HEX.test(color) ? color : defaultColor;

  return (
    <form action={action} className="space-y-5" noValidate>
      <Field id="name" label="Nom de l’agence" error={err.name}>
        <input
          id="name"
          name="name"
          required
          maxLength={80}
          defaultValue={initial.name}
          aria-invalid={err.name !== undefined}
          aria-describedby={describedBy('name', false, err.name)}
          className={INPUT_CLASS}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="website_url"
          label="Site de l’agence"
          hint="Affiché en pied de rapport."
          error={err.website_url}
        >
          <input
            id="website_url"
            name="website_url"
            type="url"
            inputMode="url"
            placeholder="https://agence.fr"
            defaultValue={initial.website_url}
            aria-invalid={err.website_url !== undefined}
            aria-describedby={describedBy('website_url', true, err.website_url)}
            className={INPUT_CLASS}
          />
        </Field>
        <Field
          id="contact_url"
          label="Lien de contact (facultatif)"
          hint="Ajoute un bouton « Prendre contact » en bas des rapports. https:// ou mailto:."
          error={err.contact_url}
        >
          <input
            id="contact_url"
            name="contact_url"
            placeholder="https://agence.fr/contact"
            defaultValue={initial.contact_url}
            aria-invalid={err.contact_url !== undefined}
            aria-describedby={describedBy('contact_url', true, err.contact_url)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="primary_color"
          label="Couleur principale"
          hint="Format #RRGGBB. Utilisée pour les accents des rapports."
          error={err.primary_color}
        >
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Choisir la couleur"
              value={swatch}
              onChange={(e) => {
                setColor(e.target.value);
              }}
              className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-[var(--border-input)] bg-[var(--bg)] p-1"
            />
            <input
              id="primary_color"
              name="primary_color"
              value={color}
              onChange={(e) => {
                setColor(e.target.value);
              }}
              placeholder={defaultColor}
              maxLength={7}
              aria-invalid={err.primary_color !== undefined}
              aria-describedby={describedBy('primary_color', true, err.primary_color)}
              className={`${INPUT_CLASS} font-mono`}
            />
          </div>
        </Field>
        <Field
          id="daily_rate_eur"
          label="Taux journalier (€ HT)"
          hint="Sert à l’estimation du temps de correction. Vide = valeur du serveur."
          error={err.daily_rate_eur}
        >
          <input
            id="daily_rate_eur"
            name="daily_rate_eur"
            type="number"
            min={0}
            max={10000}
            step={1}
            inputMode="numeric"
            defaultValue={initial.daily_rate_eur}
            aria-invalid={err.daily_rate_eur !== undefined}
            aria-describedby={describedBy('daily_rate_eur', true, err.daily_rate_eur)}
            className={INPUT_CLASS}
          />
        </Field>
      </div>
      <Field
        id="report_footer"
        label="Texte de pied de rapport"
        hint="500 caractères max. Par exemple tes mentions ou une phrase d’accroche."
        error={err.report_footer}
      >
        <textarea
          id="report_footer"
          name="report_footer"
          rows={3}
          maxLength={500}
          defaultValue={initial.report_footer}
          aria-invalid={err.report_footer !== undefined}
          aria-describedby={describedBy('report_footer', true, err.report_footer)}
          className={`${INPUT_CLASS} h-auto py-2`}
        />
      </Field>
      <Feedback state={state} />
      <DashButton type="submit" variant="primary" disabled={pending}>
        {pending ? 'Enregistrement…' : 'Enregistrer'}
      </DashButton>
    </form>
  );
}

export function LogoForm({
  name,
  logoUrl,
}: {
  name: string;
  logoUrl: string | null;
}): React.ReactElement {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadLogoAction, {
    ok: false,
    message: null,
  });
  const [removeState, setRemoveState] = useState<FormState>({ ok: false, message: null });
  const [removing, startRemove] = useTransition();
  const err = state.fieldErrors ?? {};
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <AgencyMark name={name} logoUrl={logoUrl} size={48} />
        <div className="text-[13px] text-[var(--fg-muted)]">
          {logoUrl ? 'Logo actuel.' : 'Pas de logo : l’initiale de l’agence est utilisée.'}
        </div>
      </div>
      <form action={action} className="space-y-3" noValidate>
        <Field
          id="logo"
          label="Nouveau logo"
          hint="PNG ou JPEG, 512 Ko maximum. Le SVG est refusé."
          error={err.logo}
        >
          <input
            id="logo"
            name="logo"
            type="file"
            accept="image/png,image/jpeg"
            aria-invalid={err.logo !== undefined}
            aria-describedby={describedBy('logo', true, err.logo)}
            className="block w-full min-w-0 text-[12px] text-[var(--fg-muted)] file:mr-3 file:h-8 file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--bg)] file:px-3 file:text-[13px] file:text-[var(--fg)]"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <DashButton type="submit" disabled={pending}>
            {pending ? 'Envoi…' : 'Envoyer'}
          </DashButton>
          {logoUrl ? (
            <DashButton
              type="button"
              variant="ghost"
              disabled={removing}
              onClick={() => {
                startRemove(async () => {
                  setRemoveState(await removeLogoAction());
                });
              }}
            >
              Retirer
            </DashButton>
          ) : null}
        </div>
      </form>
      <Feedback state={removeState.message ? removeState : state} />
    </div>
  );
}
