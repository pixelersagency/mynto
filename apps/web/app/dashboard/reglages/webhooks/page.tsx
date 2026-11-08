import type { ApiWebhook } from '@mynto/shared';
import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Topbar } from '../../_components/Topbar';
import { SettingsNav } from '../_components/SettingsNav';

import { ActiveToggle } from './_components/ActiveToggle';
import { EndpointStatus, dateTime } from './_components/ui';

import { DashButton } from '@/components/ui/dash-button';
import { EmptyState } from '@/components/ui/empty-state';
import { allowPrivateTargets, listWebhooks } from '@/lib/services/webhooks';

export const metadata: Metadata = { title: 'Webhooks' };
export const dynamic = 'force-dynamic';

function host(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

export default async function WebhooksPage(): Promise<React.ReactElement> {
  let rows: ApiWebhook[] = [];
  let failed = false;
  try {
    rows = await listWebhooks();
  } catch {
    failed = true;
  }
  const disabled = rows.filter((r) => !r.active && r.disabled_reason === 'auto');
  const allowPrivate = allowPrivateTargets();

  return (
    <>
      <Topbar
        crumbs={[
          {
            label: 'Réglages',
            href: '/dashboard/reglages',
          },
          { label: 'Webhooks' },
        ]}
      />
      <SettingsNav active="webhooks" />
      <main id="main" className="px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-4xl space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="dash-display">Webhooks</h1>
              <p className="mt-1 max-w-xl text-[13px] text-[var(--fg-muted)]">
                Préviens tes outils (n8n, Make, Zapier, CRM) quand un audit se termine ou qu’un
                prospect ouvre son rapport. Chaque envoi est signé, réessayé 6 fois en cas d’échec,
                et gardé 30 jours dans le journal.
              </p>
            </div>
            <DashButton asChild variant="primary">
              <Link href="/dashboard/reglages/webhooks/nouveau">
                <Plus className="h-4 w-4" aria-hidden="true" /> Nouveau webhook
              </Link>
            </DashButton>
          </div>

          {failed ? (
            <p role="alert" className="dash-note dash-note--danger">
              Impossible de lire les webhooks. Vérifie la base de données.
            </p>
          ) : null}

          {disabled.length > 0 ? (
            <div role="alert" className="dash-note dash-note--danger">
              <p className="font-medium">
                {disabled.length === 1
                  ? '1 webhook a été désactivé après 20 échecs de suite.'
                  : `${String(disabled.length)} webhooks ont été désactivés après 20 échecs de suite.`}
              </p>
              <p className="mt-1 text-[var(--fg)]">
                Vérifie l’adresse et ton outil, envoie un ping, puis réactive-le.
              </p>
            </div>
          ) : null}

          {rows.length === 0 && !failed ? (
            <EmptyState
              className="border-t border-[var(--border)] py-12"
              title="Aucun webhook pour le moment."
              description="Crée-en un pour relancer un prospect dès qu’il ouvre son rapport."
            />
          ) : rows.length > 0 ? (
            <div className="overflow-x-auto border-t border-[var(--border)]">
              <table className="w-full border-collapse text-[13px]">
                <caption className="sr-only">
                  Webhooks : adresse, événements, état, dernier envoi.
                </caption>
                <thead>
                  <tr className="text-left text-[var(--fg-muted)]">
                    <th
                      scope="col"
                      className="h-9 border-b border-[var(--border)] px-3 font-medium"
                    >
                      Adresse
                    </th>
                    <th
                      scope="col"
                      className="h-9 border-b border-[var(--border)] px-3 font-normal max-md:hidden"
                    >
                      Événements
                    </th>
                    <th
                      scope="col"
                      className="h-9 border-b border-[var(--border)] px-3 font-medium"
                    >
                      Actif
                    </th>
                    <th
                      scope="col"
                      className="h-9 border-b border-[var(--border)] px-3 font-medium"
                    >
                      Dernier statut
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <tr
                      key={w.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-subtle)]"
                    >
                      <td className="max-w-[340px] px-3 py-2.5">
                        <Link
                          href={`/dashboard/reglages/webhooks/${w.id}` as '/dashboard'}
                          className="block truncate font-mono text-[13px] dash-link"
                        >
                          {host(w.url)}
                        </Link>
                        <span className="mt-0.5 block text-[12px] text-[var(--fg-muted)]">
                          {w.description ?? 'Sans note'}
                          {w.managed_by_env ? <span>, réglé dans le .env</span> : null}
                          {w.legacy_radar_format ? <span>, format Radar</span> : null}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 max-md:hidden">
                        <span className="flex flex-wrap gap-1">
                          {w.events.slice(0, 3).map((e) => (
                            <code
                              key={e}
                              className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--fg-muted)]"
                            >
                              {e}
                            </code>
                          ))}
                          {w.events.length > 3 ? (
                            <span className="text-[12px] text-[var(--fg-muted)]">
                              +{w.events.length - 3}
                            </span>
                          ) : null}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <ActiveToggle id={w.id} active={w.active} label={host(w.url)} />
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        <EndpointStatus
                          active={w.active}
                          disabledReason={w.disabled_reason}
                          lastStatus={w.last_status}
                          lastCode={w.last_status_code}
                        />
                        {w.last_delivery_at ? (
                          <span className="mt-0.5 block text-[12px] text-[var(--fg-muted)]">
                            {dateTime(w.last_delivery_at)}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <section className="dash-group text-[13px]">
            <h2 className="dash-heading">Vérifier la signature</h2>
            <p className="mt-2 text-[var(--fg-muted)]">
              Chaque requête porte <code className="font-mono">X-Mynto-Signature: t=…,v1=…</code> :
              un HMAC-SHA256 de <code className="font-mono">horodatage.corps</code> avec le secret
              du webhook. Refuse les horodatages de plus de 5 minutes et dédoublonne sur{' '}
              <code className="font-mono">id</code>. Exemples Node, Python et n8n dans{' '}
              <code className="font-mono">docs/webhooks.md</code>.
            </p>
            <p className="mt-2 text-[var(--fg-muted)]">
              {allowPrivate
                ? 'WEBHOOKS_ALLOW_PRIVATE=1 : les adresses privées et http sont acceptées. Réserve-le à un réseau que tu maîtrises.'
                : 'Adresses publiques en HTTPS seulement. Pour un n8n sur le même réseau, active WEBHOOKS_ALLOW_PRIVATE=1 (voir la doc).'}
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
