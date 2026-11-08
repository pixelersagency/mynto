import { DEFAULT_AUDIT_MODULES, type AuditModules } from '@mynto/shared';
import type { Metadata } from 'next';

import { Topbar } from '../../_components/Topbar';
import { SettingsNav } from '../_components/SettingsNav';
import { SettingsSection } from '../_components/SettingsSection';

import { ModulesForm } from './ModulesForm';

import { db, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';

export const metadata: Metadata = { title: 'Modules d’audit' };

export default async function ModulesSettingsPage(): Promise<React.ReactElement> {
  let modules: AuditModules = { ...DEFAULT_AUDIT_MODULES };
  let failed = false;
  try {
    modules = await db().auditSettings.getModules();
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'modules_read_failed');
    failed = true;
  }
  return (
    <>
      <Topbar
        crumbs={[
          {
            label: 'Réglages',
            href: '/dashboard/reglages',
          },
          { label: 'Modules d’audit' },
        ]}
      />
      <SettingsNav active="modules" />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl">
          <h1 className="dash-display">Modules d’audit</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-[var(--fg-muted)]">
            Ce que chaque audit analyse par défaut.
          </p>
          {failed ? (
            <p role="alert" className="dash-note dash-note--danger mt-4">
              Impossible de lire les réglages. Les valeurs affichées sont celles par défaut.
            </p>
          ) : null}
          <div className="mt-8">
            <SettingsSection
              id="modules-default-title"
              title="Modules par défaut"
              description={
                <>
                  Tu peux changer la sélection au cas par cas dans « Nouvel audit », et via l’API ou
                  le serveur MCP.
                </>
              }
            >
              <ModulesForm initial={modules} />
            </SettingsSection>
          </div>
        </div>
      </main>
    </>
  );
}
