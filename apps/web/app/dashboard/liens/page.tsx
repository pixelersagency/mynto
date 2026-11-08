import type { TrackingLinkRow } from '@mynto/db';
import type { Metadata } from 'next';
import Link from 'next/link';

import { CopyButton } from '../_components/CopyButton';
import { Topbar } from '../_components/Topbar';

import { EmptyState } from '@/components/ui/empty-state';
import { displayStatus, hostOf, longDate, siteName } from '@/lib/dashboard/format';
import { db, pgErrorCode } from '@/lib/db';
import { publicUrl } from '@/lib/env';
import { logger } from '@/lib/logger';

export const metadata: Metadata = { title: 'Liens de suivi' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const PAGE = 50;

export default async function LinksPage({ searchParams }: PageProps): Promise<React.ReactElement> {
  const rawPage = (await searchParams).page;
  const page = Math.max(1, Number.parseInt(typeof rawPage === 'string' ? rawPage : '1', 10) || 1);
  let rows: TrackingLinkRow[] = [];
  let total = 0;
  let failed = false;
  try {
    const res = await db().dashboard.listLinks({ limit: PAGE, offset: (page - 1) * PAGE });
    rows = res.rows;
    total = res.total;
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'dashboard_links_failed');
    failed = true;
  }
  const base = publicUrl();

  return (
    <>
      <Topbar crumbs={[{ label: 'Liens de suivi' }]} />
      <main id="main" className="flex min-w-0 flex-1 flex-col">
        <div className="border-b border-[var(--border)] px-4 py-3">
          <h1 className="dash-heading">Liens de suivi</h1>
          <p className="mt-0.5 text-[13px] text-[var(--fg-muted)]">
            Un lien par envoi. Tu sais s’il a été ouvert, rien de plus : pas de durée de lecture,
            pas de cookie.
          </p>
        </div>
        {failed ? (
          <p role="alert" className="m-4 text-[13px] text-[var(--danger)]">
            Impossible de charger les liens.
          </p>
        ) : rows.length === 0 ? (
          <EmptyState
            title="Aucun lien pour le moment."
            description="Chaque audit lancé crée le sien."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[13px]">
              <caption className="sr-only">Liens de suivi et ouvertures</caption>
              <thead>
                <tr className="text-left text-[var(--fg-muted)]">
                  <Th>Site</Th>
                  <Th>Lien</Th>
                  <Th className="max-md:hidden">Origine</Th>
                  <Th>Ouvertures</Th>
                  <Th className="max-lg:hidden">Dernière ouverture</Th>
                  <Th className="max-md:hidden">Créé le</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const url = `${base}/r/${r.tracking_token}`;
                  const status = displayStatus(r.status, r.expires_at);
                  return (
                    <tr
                      key={r.id}
                      className="h-11 border-b border-[var(--border)] hover:bg-[var(--bg-subtle)]"
                    >
                      <td className="px-4 font-medium">
                        {siteName(`https://${r.domain}/`, r.label)}
                        {status !== 'completed' ? (
                          <span className="ml-2 text-[12px] font-normal text-[var(--fg-muted)]">
                            (
                            {status === 'running'
                              ? 'audit en cours'
                              : status === 'failed'
                                ? 'échec'
                                : 'expiré'}
                            )
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3">
                        <span className="flex items-center gap-1.5">
                          <a
                            href={`/r/${r.tracking_token}?preview=1`}
                            target="_blank"
                            rel="noopener"
                            className="dash-link"
                          >
                            {hostOf(base)}/r/{r.tracking_token.slice(0, 6)}…
                            <span className="sr-only">
                              {' '}
                              (aperçu, ne compte pas comme une ouverture)
                            </span>
                          </a>
                          <CopyButton value={url} label={`Copier le lien de ${r.domain}`} />
                        </span>
                      </td>
                      <td className="px-3 text-[var(--fg-muted)] max-md:hidden">
                        {r.origin === 'radar' ? (
                          <span>Radar{r.external_ref ? `, ${r.external_ref}` : ''}</span>
                        ) : (
                          <span>Tableau de bord</span>
                        )}
                      </td>
                      <td className="px-3 tabular-nums">
                        {r.views_count > 0 ? (
                          <span className="font-medium">{r.views_count}</span>
                        ) : (
                          <span className="text-[var(--fg-muted)]">0, pas encore ouvert</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 max-lg:hidden">
                        {r.last_viewed_at ? (
                          longDate(r.last_viewed_at)
                        ) : (
                          <span className="text-[var(--fg-muted)]">-</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 max-md:hidden">
                        {longDate(r.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {total > PAGE ? (
          <nav
            aria-label="Pagination"
            className="flex justify-between px-4 py-2.5 text-[13px] text-[var(--fg-muted)]"
          >
            <span>
              Page {page} sur {Math.ceil(total / PAGE)}
            </span>
            <span className="flex gap-2">
              {page > 1 ? (
                <Link
                  href={`/dashboard/liens?page=${String(page - 1)}` as '/dashboard/liens'}
                  className="underline"
                >
                  Précédent
                </Link>
              ) : null}
              {page * PAGE < total ? (
                <Link
                  href={`/dashboard/liens?page=${String(page + 1)}` as '/dashboard/liens'}
                  className="underline"
                >
                  Suivant
                </Link>
              ) : null}
            </span>
          </nav>
        ) : null}
      </main>
    </>
  );
}

function Th({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement {
  return (
    <th
      scope="col"
      className={`h-9 whitespace-nowrap border-b border-[var(--border)] px-3 text-[12px] font-medium first:px-4 ${className}`}
    >
      {children}
    </th>
  );
}
