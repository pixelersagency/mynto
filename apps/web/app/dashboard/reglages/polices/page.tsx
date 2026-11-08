import { CUSTOM_FONT_ID, FONT_CATALOG, fontCss } from '@mynto/templates';
import { Type } from 'lucide-react';
import type { Metadata } from 'next';

import { Topbar } from '../../_components/Topbar';
import { SettingsNav } from '../_components/SettingsNav';
import { SettingsSection } from '../_components/SettingsSection';

import { CustomFontForm, FontsForm } from './FontsForms';

import { db } from '@/lib/db';
import { fontChoice } from '@/lib/reports/templates';

export const metadata: Metadata = { title: 'Polices' };

export default async function FontsPage(): Promise<React.ReactElement> {
  const settings = await db().reports.getSettings();
  const choice = await fontChoice();
  // Every family loaded so the specimens show the real faces (served locally).
  const all = FONT_CATALOG.map(
    (f) => fontCss({ heading: f.id, body: f.id, custom: null }).css,
  ).join('\n');
  const custom = choice.custom
    ? fontCss({ heading: CUSTOM_FONT_ID, body: CUSTOM_FONT_ID, custom: choice.custom })
    : null;
  const families = [
    ...FONT_CATALOG.map((f) => ({
      id: f.id,
      name: f.name,
      kind: f.kind as string,
      stack: fontCss({ heading: f.id, body: f.id, custom: null }).heading,
    })),
    ...(custom && settings.custom_font_name
      ? [
          {
            id: CUSTOM_FONT_ID,
            name: `${settings.custom_font_name} (ta police)`,
            kind: 'custom',
            stack: custom.heading,
          },
        ]
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
          { label: 'Polices' },
        ]}
      />
      <SettingsNav active="polices" />
      <style dangerouslySetInnerHTML={{ __html: `${all}\n${custom?.css ?? ''}` }} />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <h1 id="fonts-title" className="flex items-center gap-2 dash-display">
            <Type className="h-5 w-5 text-[var(--fg-muted)]" aria-hidden="true" />
            Polices des rapports
          </h1>
          <p className="mt-1 max-w-2xl text-[13px] text-[var(--fg-muted)]">
            Appliquées au rapport web et au PDF. Les fichiers sont servis par ton instance, sans
            appel à un service de polices externe.
          </p>
          <div className="mt-8">
            <SettingsSection
              id="fonts-choice-title"
              title="Titres et texte"
              description="Un modèle de rapport peut les remplacer dans ses propres réglages."
            >
              <FontsForm
                families={families}
                heading={settings.heading_font}
                body={settings.body_font}
              />
            </SettingsSection>
            <SettingsSection
              id="custom-font-title"
              title="Ta police"
              description={
                <>
                  Fichiers woff2, 500 Ko maximum chacun : un normal (requis) et un gras (conseillé).
                  Vérifie que ta licence autorise l’usage web.
                </>
              }
            >
              <CustomFontForm
                current={settings.custom_font_name}
                hasBold={settings.custom_font_bold_key !== null}
              />
            </SettingsSection>
          </div>
        </div>
      </main>
    </>
  );
}
