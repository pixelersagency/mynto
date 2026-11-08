import { DEFAULT_AUDIT_MODULES, type AuditModules } from '@mynto/shared';
import { DEFAULT_TEMPLATE_ID } from '@mynto/templates';
import type { Metadata } from 'next';

import { Topbar } from '../_components/Topbar';

import { NewAuditForm, type TemplateOption } from './NewAuditForm';

import { db, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';
import { listTemplates } from '@/lib/reports/templates';

export const metadata: Metadata = { title: 'Nouvel audit' };

export default async function NewAuditPage(): Promise<React.ReactElement> {
  let defaults: AuditModules = { ...DEFAULT_AUDIT_MODULES };
  let templates: TemplateOption[] = [];
  let defaultTemplate: string = DEFAULT_TEMPLATE_ID;
  try {
    defaults = await db().auditSettings.getModules();
    const all = await listTemplates();
    templates = all
      .filter((t) => t.enabled)
      .map((t) => ({ id: t.id, name: t.name, description: t.description }));
    defaultTemplate = all.find((t) => t.isDefault)?.id ?? DEFAULT_TEMPLATE_ID;
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'modules_read_failed');
  }
  return (
    <>
      <Topbar
        crumbs={[
          {
            label: 'Audits',
            href: '/dashboard/audits',
          },
          { label: 'Nouvel audit' },
        ]}
      />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-2xl">
          <h1 className="dash-display">Lancer un audit</h1>
          <p className="mt-1 text-[13px] text-[var(--fg-muted)]">
            Jusqu’à 8 axes analysés en 2 à 5 minutes. Tu obtiens un rapport et un lien de suivi qui
            te dit quand le prospect l’ouvre.
          </p>
          <div className="mt-8">
            <NewAuditForm
              defaults={defaults}
              templates={templates}
              defaultTemplate={defaultTemplate}
            />
          </div>
        </div>
      </main>
    </>
  );
}
