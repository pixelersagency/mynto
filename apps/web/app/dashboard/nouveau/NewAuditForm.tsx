'use client';

import { ALL_AXES, allModulesEnabled, type AuditModules } from '@mynto/shared';
import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useActionState } from 'react';

import { Field, INPUT_CLASS, describedBy } from '../_components/fields';
import { AiReadinessFieldset, ModulesFieldset } from '../_components/ModulesFieldset';
import { createAuditAction, type FormState } from '../actions';

import { DashButton } from '@/components/ui/dash-button';
import { RadioGroup } from '@/components/ui/radio-group';

function modulesSummary(m: AuditModules): string {
  if (allModulesEnabled(m)) return 'Tous les axes et collecteurs (réglage par défaut)';
  const off = [
    !m.lighthouse ? 'Lighthouse' : null,
    !m.vision ? 'analyse visuelle' : null,
    !m.hero ? 'capture' : null,
    !m.narrative ? 'rédaction IA' : null,
  ].filter(Boolean);
  const axes = `${String(m.axes.length)} axe${m.axes.length > 1 ? 's' : ''} sur ${String(ALL_AXES.length)}`;
  return off.length > 0 ? `${axes}, sans ${off.join(', ')}` : axes;
}

export interface TemplateOption {
  id: string;
  name: string;
  description: string;
}

export function NewAuditForm({
  defaults,
  templates = [],
  defaultTemplate = 'minimal',
}: {
  defaults: AuditModules;
  templates?: TemplateOption[];
  defaultTemplate?: string;
}): React.ReactElement {
  const [state, action, pending] = useActionState<FormState, FormData>(createAuditAction, {
    ok: false,
    message: null,
  });
  const err = state.fieldErrors ?? {};
  return (
    <form action={action} className="space-y-5" noValidate>
      <Field
        id="url"
        label="Adresse du site"
        hint="La page d’accueil suffit. Le scanner suit les liens internes."
        error={err.url}
      >
        <input
          id="url"
          name="url"
          type="url"
          inputMode="url"
          required
          autoFocus
          placeholder="https://exemple.fr"
          aria-invalid={err.url !== undefined}
          aria-describedby={describedBy('url', true, err.url)}
          className={INPUT_CLASS}
        />
      </Field>
      <Field
        id="label"
        label="Libellé ou référence (facultatif)"
        hint="Visible seulement dans ton tableau de bord. Par exemple le nom du client."
        error={err.label}
      >
        <input
          id="label"
          name="label"
          type="text"
          maxLength={120}
          placeholder="Boulangerie Martin, devis 2026-114"
          aria-invalid={err.label !== undefined}
          aria-describedby={describedBy('label', true, err.label)}
          className={INPUT_CLASS}
        />
      </Field>
      <details className="group border-y border-[var(--border)]" open={err.axes !== undefined}>
        <summary className="flex cursor-pointer list-none items-center gap-2 py-3 text-[13px] [&::-webkit-details-marker]:hidden">
          <ChevronDown
            className="h-3.5 w-3.5 -rotate-90 text-[var(--fg-muted)] transition-transform group-open:rotate-0"
            aria-hidden="true"
          />
          <span className="font-medium">Modules</span>
          <span className="truncate text-[var(--fg-muted)]">{modulesSummary(defaults)}</span>
        </summary>
        <div className="pb-4 pl-[22px] pt-1">
          <p className="mb-4 text-[12px] text-[var(--fg-muted)]">
            Pour cet audit seulement. Les réglages par défaut se changent dans Réglages, Modules
            d’audit.
          </p>
          <ModulesFieldset initial={defaults} error={err.axes} idPrefix="new" withAi={false} />
        </div>
      </details>
      <div>
        <AiReadinessFieldset initial={defaults} idPrefix="new" />
      </div>
      {templates.length > 0 ? (
        <RadioGroup
          name="template"
          idPrefix="new-template"
          legend="Modèle du rapport"
          hint="Modifiable ensuite depuis la fiche de l’audit."
          columns={2}
          defaultValue={defaultTemplate}
          options={templates.map((t) => ({
            value: t.id,
            label: t.name,
            description: t.description,
          }))}
        />
      ) : null}
      <div aria-live="polite">
        {state.message ? (
          <p role="alert" className="dash-note dash-note--danger">
            {state.message}
          </p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <DashButton type="submit" variant="primary" size="lg" disabled={pending}>
          {pending ? 'Lancement…' : 'Lancer l’audit'}
        </DashButton>
        <DashButton asChild variant="ghost" size="lg">
          <Link href="/dashboard/audits">Annuler</Link>
        </DashButton>
      </div>
    </form>
  );
}
