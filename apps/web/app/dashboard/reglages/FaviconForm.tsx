'use client';

import { useActionState, useState, useTransition } from 'react';

import { Field, describedBy } from '../_components/fields';
import type { FormState } from '../actions';

import { Feedback } from './_components/Feedback';
import { removeFaviconAction, uploadFaviconAction } from './favicon-actions';

import { DashButton } from '@/components/ui/dash-button';

/**
 * Favicon of the instance (dashboard, login, public reports). Without an
 * uploaded favicon the logo is used ("Utiliser le logo"), then the default
 * icon. The preview shows the effective icon as served.
 */
export function FaviconForm({
  faviconUrl,
  hasCustomFavicon,
  hasLogo,
}: {
  faviconUrl: string;
  hasCustomFavicon: boolean;
  hasLogo: boolean;
}): React.ReactElement {
  const [state, action, pending] = useActionState<FormState, FormData>(uploadFaviconAction, {
    ok: false,
    message: null,
  });
  const [removeState, setRemoveState] = useState<FormState>({ ok: false, message: null });
  const [removing, startRemove] = useTransition();
  const err = state.fieldErrors ?? {};
  const status = hasCustomFavicon
    ? 'Favicon personnalisé.'
    : hasLogo
      ? 'Utiliser le logo : ton logo sert de favicon, centré sur un carré.'
      : 'Ni favicon ni logo : l’icône par défaut est utilisée.';

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="flex items-end gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] p-2">
          <img src={faviconUrl} alt="" width={32} height={32} className="h-8 w-8 object-contain" />
          <img src={faviconUrl} alt="" width={16} height={16} className="h-4 w-4 object-contain" />
        </div>
        <p className="text-[13px] text-[var(--fg-muted)]">{status}</p>
      </div>
      <form action={action} className="space-y-3" noValidate>
        <Field
          id="favicon"
          label="Nouveau favicon"
          hint="Image carrée, 512 x 512 pixels recommandés. PNG, SVG ou ICO, 256 Ko maximum."
          error={err.favicon}
        >
          <input
            id="favicon"
            name="favicon"
            type="file"
            accept="image/png,image/svg+xml,image/x-icon,image/vnd.microsoft.icon,.ico"
            aria-invalid={err.favicon !== undefined}
            aria-describedby={describedBy('favicon', true, err.favicon)}
            className="block w-full min-w-0 text-[12px] text-[var(--fg-muted)] file:mr-3 file:h-8 file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--bg)] file:px-3 file:text-[13px] file:text-[var(--fg)]"
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          <DashButton type="submit" disabled={pending}>
            {pending ? 'Envoi…' : 'Envoyer'}
          </DashButton>
          {hasCustomFavicon ? (
            <DashButton
              type="button"
              variant="ghost"
              disabled={removing}
              onClick={() => {
                startRemove(async () => {
                  setRemoveState(await removeFaviconAction());
                });
              }}
            >
              {hasLogo ? 'Retirer et utiliser le logo' : 'Retirer'}
            </DashButton>
          ) : null}
        </div>
      </form>
      <Feedback state={removeState.message ? removeState : state} />
    </div>
  );
}
