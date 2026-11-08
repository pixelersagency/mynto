'use client';

import { useActionState } from 'react';

import { saveBrandBasicsAction, type WizardState } from './actions';

import { DashButton } from '@/components/ui/dash-button';

/** First-run step 1: agency name and color. */
export function BrandStep({ name, color }: { name: string; color: string }): React.ReactElement {
  const [state, action, pending] = useActionState<WizardState, FormData>(saveBrandBasicsAction, {
    ok: false,
    message: null,
  });
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <label htmlFor="wiz-name" className="block text-[12px] text-[var(--fg-muted)]">
          Nom de l’agence
        </label>
        <input
          id="wiz-name"
          name="name"
          required
          maxLength={80}
          defaultValue={name}
          className="mt-1 h-8 w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[13px]"
        />
      </div>
      <div>
        <label htmlFor="wiz-color" className="block text-[12px] text-[var(--fg-muted)]">
          Couleur
        </label>
        <input
          id="wiz-color"
          name="primary_color"
          type="color"
          defaultValue={color}
          className="mt-1 h-8 w-12 cursor-pointer rounded-md border border-[var(--border)] bg-[var(--bg)] p-0.5"
        />
      </div>
      <DashButton type="submit" disabled={pending}>
        Enregistrer
      </DashButton>
      {state.message ? (
        <p
          role="status"
          className={`basis-full text-[12px] ${state.ok ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
