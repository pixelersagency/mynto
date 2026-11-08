import {
  FONT_CATALOG,
  SECTION_LABEL,
  TEMPLATE_ID_PATTERN,
  resolveSettings,
} from '@mynto/templates';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { Topbar } from '../../../_components/Topbar';
import { SettingsNav } from '../../_components/SettingsNav';

import { TemplateSettingsForm } from './TemplateSettingsForm';

import { db } from '@/lib/db';
import { renderTemplatePreview } from '@/lib/reports/render';
import { loadTemplateBundle } from '@/lib/reports/templates';

export const metadata: Metadata = { title: 'Réglages du modèle' };

export default async function TemplateSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  if (!TEMPLATE_ID_PATTERN.test(id)) notFound();
  const bundle = await loadTemplateBundle(id);
  if (bundle === null) notFound();
  const [state, reportSettings] = await Promise.all([
    db().reports.getState(id),
    db().reports.getSettings(),
  ]);
  const stored = state?.settings ?? {};
  const { values, sections } = resolveSettings(bundle.manifest, stored);
  const preview = await renderTemplatePreview(bundle, stored);
  const fonts = [
    { value: 'inherit', label: 'Celle de Réglages, Polices' },
    ...FONT_CATALOG.map((f) => ({ value: f.id, label: f.name })),
    ...(reportSettings.custom_font_name
      ? [{ value: 'custom', label: `${reportSettings.custom_font_name} (ta police)` }]
      : []),
  ];
  return (
    <>
      <Topbar
        crumbs={[
          {
            label: 'Réglages',
            href: '/dashboard/reglages',
          },
          { label: 'Modèles de rapport', href: '/dashboard/reglages/modeles' },
          { label: bundle.manifest.name },
        ]}
      />
      <SettingsNav active="modeles" />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-[1280px]">
          <h1 className="dash-display">Réglages de « {bundle.manifest.name} »</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-[var(--fg-muted)]">
            Ces réglages viennent du manifest du modèle. L’aperçu se met à jour sur un audit
            d’exemple, avec ta marque.
          </p>
          <TemplateSettingsForm
            id={id}
            settings={bundle.manifest.settings}
            initialValues={values}
            initialSections={sections}
            sectionLabels={SECTION_LABEL}
            fonts={fonts}
            initialPreview={preview}
          />
        </div>
      </main>
    </>
  );
}
