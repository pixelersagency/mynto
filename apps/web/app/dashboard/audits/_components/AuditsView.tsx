import type { DashboardAuditRow } from '@mynto/db';
import { disabledAxes, parseStoredModules } from '@mynto/shared';
import { Download, Plus } from 'lucide-react';
import Link from 'next/link';

import { AuditsTable, type AuditRowView } from '../../_components/AuditsTable';
import { AutoRefresh } from '../../_components/AutoRefresh';
import { FilterMenu, SortMenu } from '../../_components/ListMenus';
import { Topbar } from '../../_components/Topbar';

import { PanelShell } from './PanelShell';

import { DashButton } from '@/components/ui/dash-button';
import { EmptyState } from '@/components/ui/empty-state';
import {
  aiScoreView,
  displayStatus,
  hostOf,
  score100,
  siteName,
  weakAxes,
  longDate,
  axisBars,
  scoreDelta,
} from '@/lib/dashboard/format';
import {
  PAGE_SIZE,
  listQuery,
  parseListParams,
  toRepoFilter,
  type DashboardView,
  type ListParams,
} from '@/lib/dashboard/params';
import { db, pgErrorCode } from '@/lib/db';
import { publicUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

export const AUDITS_PATH = '/dashboard/audits';

const VIEW_TABS: { vue: DashboardView; label: string }[] = [
  { vue: 'tous', label: 'Tous' },
  {
    vue: 'en-cours',
    label: 'En cours',
  },
  {
    vue: 'echecs',
    label: 'Échecs',
  },
  { vue: 'radar', label: 'Radar' },
  {
    vue: 'mois',
    label: 'Ce mois-ci',
  },
];

const VIEW_TITLE: Record<DashboardView, string> = {
  tous: 'Tous les audits',
  'en-cours': 'En cours',
  echecs: 'Échecs',
  radar: 'Radar',
  mois: 'Ce mois-ci',
};

function toView(row: DashboardAuditRow): AuditRowView {
  const status = displayStatus(row.status, row.expires_at);
  return {
    id: row.id,
    slug: row.slug,
    url: row.url,
    host: hostOf(row.url),
    name: siteName(row.url, row.label),
    label: row.label,
    source: row.source,
    status,
    score: status === 'completed' || status === 'expired' ? score100(row.global_score) : null,
    createdAt: row.created_at,
    createdLabel: longDate(row.created_at),
    pages: row.pages,
    weakAxes: status === 'completed' ? weakAxes(row.axis_scores) : [],
    notEvaluated: row.modules === null ? [] : disabledAxes(parseStoredModules(row.modules)),
    aiScore:
      status === 'completed' || status === 'expired'
        ? aiScoreView(row.ai_score, row.ai_status)
        : null,
    trackingToken: row.tracking_token,
    opened: row.views_count > 0,
    views: row.views_count,
    lastViewedAt: row.last_viewed_at,
    faviconUrl: row.favicon_key ? `/media/${row.favicon_key}` : null,
    heroUrl: row.hero_screenshot_key ? `/media/hero/${row.id}.png` : null,
    delta: scoreDelta(row.global_score, row.prev_score),
    axes: status === 'completed' ? axisBars(row.axis_scores, row.modules) : [],
    progressStep:
      status === 'running'
        ? row.status === 'queued'
          ? 'queued'
          : ((row.progress_step as 'loading' | 'analysis' | 'writing' | null) ?? 'loading')
        : null,
    recentlyOpened:
      row.last_viewed_at !== null && Date.now() - Date.parse(row.last_viewed_at) < 24 * 3600_000,
  };
}

export async function AuditsView({
  raw,
  panel,
  selectedId = null,
}: {
  raw: Record<string, string | string[] | undefined>;
  /** Side panel of the selected audit (/dashboard/audits/<id>). */
  panel?: React.ReactNode;
  selectedId?: string | null;
}): Promise<React.ReactElement> {
  const params = parseListParams(raw);
  const highlight = typeof raw.nouveau === 'string' ? raw.nouveau : null;

  let rows: AuditRowView[] = [];
  let total = 0;
  let failed = false;
  try {
    const res = await db().dashboard.listAudits(toRepoFilter(params));
    rows = res.rows.map(toView);
    total = res.total;
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'dashboard_list_failed');
    failed = true;
  }

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (params.page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, params.page * PAGE_SIZE);
  const anyRunning = rows.some((r) => r.status === 'running');
  const exportHref = `/api/dashboard/export${listQuery({ ...params, page: 1 })}`;
  const q = listQuery(params);
  const idx = selectedId === null ? -1 : rows.findIndex((r) => r.id === selectedId);

  return (
    <>
      <Topbar
        crumbs={[
          {
            label: 'Audits',
            href: AUDITS_PATH,
          },
          { label: VIEW_TITLE[params.vue] },
        ]}
      >
        <DashButton asChild variant="secondary" size="md" className="max-md:hidden">
          <a href={exportHref} download>
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Exporter
          </a>
        </DashButton>
      </Topbar>

      <main id="main" className="flex min-w-0 flex-1 flex-col">
        <h1 className="sr-only">Audits : {VIEW_TITLE[params.vue]}</h1>
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-3 py-2 sm:px-4">
          <nav
            aria-label="Vues enregistrées"
            className="-mx-1 flex min-w-0 flex-1 overflow-x-auto max-sm:basis-full"
          >
            <ul className="flex items-center gap-1 px-1">
              {VIEW_TABS.map((t) => {
                const active = params.vue === t.vue;
                return (
                  <li key={t.vue}>
                    <Link
                      href={`${AUDITS_PATH}${listQuery({ vue: t.vue })}` as '/dashboard'}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex h-8 items-center whitespace-nowrap rounded-md px-2.5 text-[13px] text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]',
                        active && 'bg-[var(--bg-subtle)] font-medium text-[var(--fg)]',
                      )}
                    >
                      {t.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex items-center gap-1.5 max-sm:w-full max-sm:justify-end">
            <SortMenu params={params} />
            <FilterMenu params={params} />
            <form action={AUDITS_PATH} method="get" role="search" className="max-sm:hidden">
              {params.vue !== 'tous' ? <input type="hidden" name="vue" value={params.vue} /> : null}
              <label htmlFor="list-search" className="sr-only">
                Rechercher dans la liste
              </label>
              <input
                id="list-search"
                name="q"
                type="search"
                defaultValue={params.q}
                placeholder="Rechercher"
                className="h-8 w-40 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2.5 text-[13px] placeholder:text-[var(--fg-muted)] focus:w-56 focus-visible:border-[var(--accent)] motion-safe:transition-[width]"
              />
            </form>
            <DashButton asChild variant="primary" size="md">
              <Link href="/dashboard/nouveau">
                <Plus className="h-4 w-4" aria-hidden="true" />
                Nouvel audit
              </Link>
            </DashButton>
          </div>
        </div>

        <ActiveFilters params={params} />

        {failed ? (
          <p role="alert" className="dash-note dash-note--danger m-4">
            Impossible de charger les audits. Vérifie la connexion à la base de données.
          </p>
        ) : rows.length === 0 ? (
          <AuditsEmpty params={params} />
        ) : (
          <AuditsTable
            rows={rows}
            publicUrl={publicUrl()}
            highlightId={highlight}
            selectedId={selectedId}
            query={listQuery(params)}
            fadeTail={params.page < pages}
          />
        )}

        {total > 0 ? (
          <nav
            aria-label="Pagination"
            className="flex items-center justify-between gap-2 border-t border-[var(--border)] px-4 py-2.5 text-[13px] text-[var(--fg-muted)]"
          >
            <span aria-live="polite">
              {from}-{to} sur {total}
            </span>
            <span className="flex gap-1.5">
              <PageLink params={params} page={params.page - 1} disabled={params.page <= 1}>
                Précédent
              </PageLink>
              <PageLink params={params} page={params.page + 1} disabled={params.page >= pages}>
                Suivant
              </PageLink>
            </span>
          </nav>
        ) : null}
        {anyRunning ? <AutoRefresh intervalMs={5_000} /> : null}
      </main>
      {panel ? (
        <PanelShell
          closeHref={`${AUDITS_PATH}${q}`}
          prevHref={idx > 0 ? `${AUDITS_PATH}/${rows[idx - 1]?.id ?? ''}${q}` : null}
          nextHref={
            idx >= 0 && idx < rows.length - 1
              ? `${AUDITS_PATH}/${rows[idx + 1]?.id ?? ''}${q}`
              : null
          }
        >
          {panel}
        </PanelShell>
      ) : null}
    </>
  );
}

function PageLink({
  params,
  page,
  disabled,
  children,
}: {
  params: ListParams;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  if (disabled) {
    return (
      <span
        aria-disabled="true"
        className="inline-flex h-7 items-center rounded-md border border-[var(--border)] px-2.5 text-[var(--fg-muted)]"
      >
        {children}
      </span>
    );
  }
  return (
    <Link
      href={`${AUDITS_PATH}${listQuery({ ...params, page })}` as '/dashboard'}
      className="inline-flex h-7 items-center rounded-md border border-[var(--border)] px-2.5 text-[var(--fg)] hover:bg-[var(--bg-hover)]"
    >
      {children}
    </Link>
  );
}

const STATUS_FILTER_LABEL = {
  'en-cours': 'En cours',
  termine: 'Terminés',
  echec: 'Échecs',
  expire: 'Expirés',
} as const;

function ActiveFilters({ params }: { params: ListParams }): React.ReactElement | null {
  const chips: { label: string; href: string }[] = [];
  if (params.q)
    chips.push({ label: `« ${params.q} »`, href: listQuery({ ...params, q: '', page: 1 }) });
  if (params.statut)
    chips.push({
      label: STATUS_FILTER_LABEL[params.statut],
      href: listQuery({ ...params, statut: null, page: 1 }),
    });
  if (params.mois) {
    const [y, m] = params.mois.split('-');
    const label = new Intl.DateTimeFormat('fr-FR', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(Date.UTC(Number(y), Number(m) - 1, 1)));
    chips.push({ label, href: listQuery({ ...params, mois: null, page: 1 }) });
  }
  if (params.ia === 'faible')
    chips.push({
      label: 'Préparation IA faible',
      href: listQuery({ ...params, ia: null, page: 1 }),
    });
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--border)] px-4 py-2 text-[12px]">
      <span className="text-[var(--fg-muted)]">Filtres :</span>
      {chips.map((c) => (
        <Link
          key={c.label}
          href={`${AUDITS_PATH}${c.href}` as '/dashboard'}
          className="inline-flex h-6 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-[var(--fg)] hover:bg-[var(--bg-hover)]"
        >
          {c.label}
          <span aria-hidden="true" className="text-[var(--fg-muted)]">
            ×
          </span>
          <span className="sr-only">, retirer ce filtre</span>
        </Link>
      ))}
    </div>
  );
}

function AuditsEmpty({ params }: { params: ListParams }): React.ReactElement {
  const filtered =
    params.q.length > 0 ||
    params.statut !== null ||
    params.mois !== null ||
    params.ia !== null ||
    params.vue !== 'tous';
  return (
    <EmptyState
      title={filtered ? 'Aucun audit ne correspond.' : 'Aucun audit pour le moment.'}
      description={
        filtered
          ? 'Change de vue ou retire un filtre.'
          : 'Lance un premier audit : tu obtiens un rapport sur 8 axes et un lien de suivi à envoyer.'
      }
      action={
        filtered ? (
          <DashButton asChild size="md">
            <Link href={AUDITS_PATH}>Voir tous les audits</Link>
          </DashButton>
        ) : (
          <DashButton asChild variant="primary" size="md">
            <Link href="/dashboard/nouveau">
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nouvel audit
            </Link>
          </DashButton>
        )
      }
    />
  );
}
