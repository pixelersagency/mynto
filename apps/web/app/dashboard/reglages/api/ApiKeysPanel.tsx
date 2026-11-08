'use client';

import { Check, Copy, Plus } from 'lucide-react';
import { useActionState, useRef, useState, useTransition } from 'react';

import { Field, INPUT_CLASS, describedBy } from '../../_components/fields';
import { Feedback } from '../_components/Feedback';
import {
  createApiKeyAction,
  revokeApiKeyAction,
  type CreatedKeyState,
  type SettingsState,
} from '../actions';

import { DashButton } from '@/components/ui/dash-button';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  createdLabel: string;
  lastUsedLabel: string | null;
  revoked: boolean;
}

export function CopyField({
  label,
  value,
  id,
}: {
  label: string;
  value: string;
  id: string;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1.5">
      <p id={`${id}-label`} className="text-[12px] font-medium text-[var(--fg-muted)]">
        {label}
      </p>
      <div className="flex items-start gap-2">
        <pre
          id={id}
          aria-labelledby={`${id}-label`}
          tabIndex={0}
          className="min-w-0 flex-1 overflow-x-auto whitespace-pre rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-3 py-2 font-mono text-[12px] leading-5"
        >
          {value}
        </pre>
        <DashButton
          size="sm"
          aria-label={`Copier : ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => {
                setCopied(false);
              }, 2000);
            });
          }}
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {copied ? 'Copié' : 'Copier'}
        </DashButton>
      </div>
    </div>
  );
}

export function ApiKeysPanel({ keys }: { keys: ApiKeyView[] }): React.ReactElement {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<CreatedKeyState, FormData>(
    async (prev, form) => {
      const res = await createApiKeyAction(prev, form);
      if (res.ok) formRef.current?.reset();
      return res;
    },
    { ok: false, message: null },
  );
  const [result, setResult] = useState<SettingsState>({ ok: false, message: null });
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const err = state.fieldErrors?.name;

  return (
    <div className="space-y-5">
      <form ref={formRef} action={action} className="flex flex-wrap items-end gap-3" noValidate>
        <div className="min-w-56 flex-1">
          <Field
            id="key-name"
            label="Nom de la clé"
            hint="Par exemple l’outil qui l’utilise : Zapier, n8n, Claude."
            error={err}
          >
            <input
              id="key-name"
              name="name"
              maxLength={80}
              required
              autoComplete="off"
              aria-invalid={err !== undefined}
              aria-describedby={describedBy('key-name', true, err)}
              className={INPUT_CLASS}
            />
          </Field>
        </div>
        <DashButton type="submit" variant="primary" disabled={pending} className="mb-[22px]">
          <Plus className="h-4 w-4" aria-hidden="true" /> {pending ? 'Création…' : 'Créer une clé'}
        </DashButton>
      </form>

      {state.ok && state.secret ? (
        <div role="status" className="dash-note space-y-3">
          <p className="text-[13px] font-medium text-[var(--success)]">{state.message}</p>
          <CopyField id="new-key" label="Ta nouvelle clé" value={state.secret} />
        </div>
      ) : (
        <Feedback state={state.fieldErrors ? { ok: false, message: null } : state} />
      )}

      {keys.length === 0 ? (
        <EmptyState
          className="border-t border-[var(--border)] py-12"
          title="Aucune clé pour le moment."
          description="Crée une clé pour lancer et lire tes audits depuis tes outils ou depuis Claude."
        />
      ) : (
        <div className="overflow-x-auto border-t border-[var(--border)]">
          <table className="w-full border-collapse text-[13px]">
            <caption className="sr-only">
              Clés API : nom, préfixe, création, dernière utilisation, état.
            </caption>
            <thead>
              <tr className="text-left text-[var(--fg-muted)]">
                <th scope="col" className="h-9 border-b border-[var(--border)] px-3 font-normal">
                  Nom
                </th>
                <th scope="col" className="h-9 border-b border-[var(--border)] px-3 font-normal">
                  Préfixe
                </th>
                <th
                  scope="col"
                  className="h-9 border-b border-[var(--border)] px-3 font-normal max-sm:hidden"
                >
                  Créée le
                </th>
                <th
                  scope="col"
                  className="h-9 border-b border-[var(--border)] px-3 font-normal max-sm:hidden"
                >
                  Dernier appel
                </th>
                <th scope="col" className="h-9 border-b border-[var(--border)] px-3 font-normal">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr
                  key={k.id}
                  className={cn(
                    'h-11 border-b border-[var(--border)] last:border-0',
                    k.revoked && 'text-[var(--fg-muted)]',
                  )}
                >
                  <td className="px-3">
                    <span className="inline-flex items-center gap-2 font-medium">{k.name}</span>
                  </td>
                  <td className="px-3">
                    <code className="font-mono text-[12px]">{k.prefix}…</code>
                  </td>
                  <td className="whitespace-nowrap px-3 max-sm:hidden">{k.createdLabel}</td>
                  <td className="whitespace-nowrap px-3 max-sm:hidden">
                    {k.lastUsedLabel ?? 'Jamais'}
                  </td>
                  <td className="whitespace-nowrap px-3 text-right">
                    {k.revoked ? (
                      <span className="inline-flex items-center gap-1 text-[12px]">Révoquée</span>
                    ) : confirmId === k.id ? (
                      <span className="inline-flex items-center gap-1.5">
                        <DashButton
                          size="sm"
                          variant="danger"
                          disabled={busy}
                          onClick={() => {
                            start(async () => {
                              setResult(await revokeApiKeyAction(k.id));
                              setConfirmId(null);
                            });
                          }}
                        >
                          Confirmer
                        </DashButton>
                        <DashButton
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setConfirmId(null);
                          }}
                        >
                          Annuler
                        </DashButton>
                      </span>
                    ) : (
                      <DashButton
                        size="sm"
                        className="text-[var(--danger)]"
                        onClick={() => {
                          setConfirmId(k.id);
                        }}
                        aria-label={`Révoquer la clé ${k.name}`}
                      >
                        Révoquer
                      </DashButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Feedback state={result} />
    </div>
  );
}
