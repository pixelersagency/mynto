'use client';

import { useActionState, useState, useTransition } from 'react';

import { Feedback } from '../_components/Feedback';

import {
  removeCustomFontAction,
  saveFontsAction,
  uploadCustomFontAction,
  type FontState,
} from './actions';

import { DashButton } from '@/components/ui/dash-button';
import { RadioGroup } from '@/components/ui/radio-group';

interface Family {
  id: string;
  name: string;
  kind: string;
  stack: string;
}

const INITIAL: FontState = { ok: false, message: null };

export function FontsForm({
  families,
  heading,
  body,
}: {
  families: Family[];
  heading: string;
  body: string;
}): React.ReactElement {
  const [state, action, pending] = useActionState(saveFontsAction, INITIAL);
  const [h, setH] = useState(heading);
  const [b, setB] = useState(body);
  const stackOf = (id: string): string => families.find((f) => f.id === id)?.stack ?? 'system-ui';
  return (
    <form action={action} className="grid gap-6">
      <div className="grid gap-5 sm:grid-cols-2">
        {[
          { key: 'heading', label: 'Titres', value: h, set: setH },
          { key: 'body', label: 'Texte', value: b, set: setB },
        ].map((g) => (
          <RadioGroup
            key={g.key}
            name={g.key}
            legend={g.label}
            value={g.value}
            onValueChange={g.set}
            options={families.map((f) => ({
              value: f.id,
              label: <span className="text-[15px] font-normal">{f.name}</span>,
              labelStyle: { fontFamily: f.stack },
              aside: f.kind === 'serif' ? 'Serif' : f.kind === 'custom' ? 'Importée' : 'Sans serif',
            }))}
          />
        ))}
      </div>
      <div className="lg:sticky lg:top-16 lg:self-start">
        <p className="text-[13px] font-medium">Aperçu</p>
        <div className="mt-2 rounded-lg border border-[var(--border)] bg-white p-5 text-[#18181b]">
          <p
            style={{ fontFamily: stackOf(h) }}
            className="text-[26px] font-bold leading-tight tracking-tight"
          >
            Audit de boulangerie-martin.fr
          </p>
          <p style={{ fontFamily: stackOf(h) }} className="mt-4 text-[44px] font-bold leading-none">
            58<span className="text-[15px] font-medium text-[#5b5b66]">/100</span>
          </p>
          <p style={{ fontFamily: stackOf(b) }} className="mt-4 text-[15px] leading-relaxed">
            Le site présente bien la boutique mais il perd des commandes. Trois chantiers courts
            suffisent à corriger l’essentiel.
          </p>
        </div>
        <div className="mt-4 flex items-center gap-3">
          <DashButton type="submit" variant="primary" disabled={pending}>
            Enregistrer
          </DashButton>
          <Feedback state={state} />
        </div>
      </div>
    </form>
  );
}

export function CustomFontForm({
  current,
  hasBold,
}: {
  current: string | null;
  hasBold: boolean;
}): React.ReactElement {
  const [state, action, pending] = useActionState(uploadCustomFontAction, INITIAL);
  const [removed, setRemoved] = useState<FontState>(INITIAL);
  const [removing, start] = useTransition();
  const input = 'mt-1 block w-full text-[13px]';
  return (
    <div className="mt-4 space-y-4">
      {current ? (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--bg-subtle)] px-3 py-2 text-[13px]">
          <span>
            <span className="font-medium">{current}</span>{' '}
            <span className="text-[var(--fg-muted)]">
              {hasBold ? 'normal et gras' : 'normal seulement'}
            </span>
          </span>
          <DashButton
            size="sm"
            variant="ghost"
            disabled={removing}
            onClick={() => {
              start(async () => {
                setRemoved(await removeCustomFontAction());
              });
            }}
          >
            Retirer
          </DashButton>
        </div>
      ) : null}
      <Feedback state={removed} />
      <form action={action} className="grid gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="font-name" className="text-[13px] font-medium">
            Nom
          </label>
          <input
            id="font-name"
            name="name"
            required
            maxLength={40}
            defaultValue={current ?? ''}
            aria-invalid={state.fieldErrors?.name ? true : undefined}
            aria-describedby={state.fieldErrors?.name ? 'font-name-error' : undefined}
            className="mt-1 h-9 w-full rounded-md border border-[var(--border-input)] bg-[var(--bg)] px-3 text-[14px]"
          />
          {state.fieldErrors?.name ? (
            <p id="font-name-error" className="mt-1 text-[12px] text-[var(--danger)]">
              {state.fieldErrors.name}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="font-regular" className="text-[13px] font-medium">
            Normal (woff2)
          </label>
          <input
            id="font-regular"
            name="regular"
            type="file"
            accept=".woff2,font/woff2"
            required
            className={input}
            aria-describedby={state.fieldErrors?.regular ? 'font-regular-error' : undefined}
          />
          {state.fieldErrors?.regular ? (
            <p id="font-regular-error" className="mt-1 text-[12px] text-[var(--danger)]">
              {state.fieldErrors.regular}
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor="font-bold" className="text-[13px] font-medium">
            Gras (woff2)
          </label>
          <input
            id="font-bold"
            name="bold"
            type="file"
            accept=".woff2,font/woff2"
            className={input}
            aria-describedby={state.fieldErrors?.bold ? 'font-bold-error' : undefined}
          />
          {state.fieldErrors?.bold ? (
            <p id="font-bold-error" className="mt-1 text-[12px] text-[var(--danger)]">
              {state.fieldErrors.bold}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-3 sm:col-span-3">
          <DashButton type="submit" disabled={pending}>
            Importer la police
          </DashButton>
          <Feedback state={state} />
        </div>
      </form>
    </div>
  );
}
