import { LayoutTemplate } from 'lucide-react';
import type { Metadata } from 'next';

import { Topbar } from '../../_components/Topbar';
import { SettingsNav } from '../_components/SettingsNav';

import { ImportTemplate, TemplateCard } from './Gallery';

import { db, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';
import { listTemplates, type TemplateEntry } from '@/lib/reports/templates';

export const metadata: Metadata = { title: 'Modèles de rapport' };

export default async function TemplatesPage(): Promise<React.ReactElement> {
  let templates: TemplateEntry[] = [];
  let usage = new Map<string, number>();
  let failed = false;
  try {
    templates = await listTemplates();
    const { rows } = await db().dashboard.listAudits({ limit: 5000 });
    usage = rows.reduce(
      (m, r) => m.set(r.template_id ?? '', (m.get(r.template_id ?? '') ?? 0) + 1),
      new Map<string, number>(),
    );
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'templates_list_failed');
    failed = true;
  }
  const custom = templates.filter((t) => !t.builtin);
  return (
    <>
      <Topbar
        crumbs={[
          {
            label: 'Réglages',
            href: '/dashboard/reglages',
          },
          { label: 'Modèles de rapport' },
        ]}
      />
      <SettingsNav active="modeles" />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="flex items-center gap-2 dash-display">
                <LayoutTemplate className="h-5 w-5 text-[var(--fg-muted)]" aria-hidden="true" />
                Modèles de rapport
              </h1>
              <p className="mt-1 max-w-2xl text-[13px] text-[var(--fg-muted)]">
                Le même moteur rend le rapport web et le PDF. Duplique un modèle, exporte-le, adapte
                le Liquid et le CSS (toi ou ton agent IA), puis réimporte le .zip : il est vérifié
                avant d’être enregistré.
              </p>
            </div>
            <ImportTemplate />
          </div>
          {failed ? (
            <p role="alert" className="mt-6 text-[13px] text-[var(--danger)]">
              Impossible de charger les modèles. Vérifie la connexion à la base de données.
            </p>
          ) : (
            <>
              <h2 className="mt-10 dash-heading">Modèles fournis</h2>
              <ul className="mt-4 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                {templates
                  .filter((t) => t.builtin)
                  .map((t) => (
                    <TemplateCard key={t.id} t={toCard(t, usage)} />
                  ))}
              </ul>
              <h2 className="mt-12 dash-heading">Tes modèles</h2>
              {custom.length === 0 ? (
                <div className="mt-3 border-t border-[var(--border)] pt-4">
                  <p className="text-[14px] font-medium">Pas encore de modèle à toi.</p>
                  <p className="mt-1 max-w-md text-[13px] text-[var(--fg-muted)]">
                    Duplique Minimaliste, Bento ou Style Mynto, ou importe un .zip. Le guide pour
                    créer un modèle est dans docs/templates/README.md.
                  </p>
                </div>
              ) : (
                <ul className="mt-4 grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
                  {custom.map((t) => (
                    <TemplateCard key={t.id} t={toCard(t, usage)} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}

function toCard(t: TemplateEntry, usage: Map<string, number>) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    version: t.version,
    builtin: t.builtin,
    enabled: t.enabled,
    isDefault: t.isDefault,
    basedOn: t.basedOn,
    hasPreview: t.hasPreview,
    audits: (usage.get(t.id) ?? 0) + (t.isDefault ? (usage.get('') ?? 0) : 0),
  };
}
