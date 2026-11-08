import Link from 'next/link';

import { autoDisabledWebhooks } from '@/lib/services/webhooks';
import { cn } from '@/lib/utils';

export type SettingsTab =
  | 'marque'
  | 'modeles'
  | 'polices'
  | 'email'
  | 'modules'
  | 'ia'
  | 'api'
  | 'webhooks';

const TABS: { tab: SettingsTab; href: string; label: string }[] = [
  { tab: 'marque', href: '/dashboard/reglages', label: 'Marque' },
  { tab: 'modeles', href: '/dashboard/reglages/modeles', label: 'Modèles de rapport' },
  { tab: 'polices', href: '/dashboard/reglages/polices', label: 'Polices' },
  { tab: 'email', href: '/dashboard/reglages/email', label: 'Email' },
  { tab: 'modules', href: '/dashboard/reglages/modules', label: 'Modules d’audit' },
  { tab: 'ia', href: '/dashboard/reglages/ia', label: 'IA' },
  { tab: 'api', href: '/dashboard/reglages/api', label: 'API et MCP' },
  { tab: 'webhooks', href: '/dashboard/reglages/webhooks', label: 'Webhooks' },
];

/**
 * Sub-navigation of the settings pages. The Webhooks tab carries a red
 * badge while endpoints are switched off after too many failures.
 */
export async function SettingsNav({
  active,
}: {
  active: SettingsTab;
}): Promise<React.ReactElement> {
  const alerts = (await autoDisabledWebhooks()).length;
  return (
    <nav
      aria-label="Sections des réglages"
      className="border-b border-[var(--border)] px-3 sm:px-4"
    >
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const on = t.tab === active;
          return (
            <li key={t.tab}>
              <Link
                href={t.href as '/dashboard'}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'inline-flex h-10 items-center whitespace-nowrap border-b-2 px-2.5 text-[13px]',
                  on
                    ? 'border-[var(--fg)] font-medium text-[var(--fg)]'
                    : 'border-transparent text-[var(--fg-muted)] hover:text-[var(--fg)]',
                )}
              >
                {t.label}
                {t.tab === 'webhooks' && alerts > 0 ? (
                  <span className="ml-1.5 inline-flex items-center gap-1 text-[12px] font-medium tabular-nums text-[var(--danger)]">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full bg-[var(--danger)]"
                    />
                    {alerts}
                    <span className="sr-only">
                      {alerts === 1 ? ' webhook désactivé' : ' webhooks désactivés'}
                    </span>
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export const SETTINGS_TAB_LABEL: Record<SettingsTab, string> = {
  marque: 'Marque',
  modeles: 'Modèles de rapport',
  polices: 'Polices',
  email: 'Email',
  modules: 'Modules d’audit',
  ia: 'IA',
  api: 'API et MCP',
  webhooks: 'Webhooks',
};
