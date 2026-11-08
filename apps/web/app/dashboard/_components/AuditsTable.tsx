'use client';

import type { AuditAxis } from '@mynto/shared';
import { Copy, Download, ExternalLink, MoreHorizontal, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { deleteAuditsAction, refreshAuditsAction, type BulkResult } from '../actions';

import { beginMutation } from './mutation-lock';
import { applyOptimistic } from './optimistic';
import { SitePreview } from './SitePreview';

import { DashButton } from '@/components/ui/dash-button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AXIS_LONG,
  SCORE_BAND_LABEL,
  SOURCE_LABEL,
  STATUS_LABEL,
  previewPath,
  reportUrl,
  scoreBand,
  PROGRESS_LABEL,
  type AxisBar,
  type DisplayStatus,
  type ProgressStep,
} from '@/lib/dashboard/format';
import type { AiScoreView } from '@/lib/dashboard/format';
import { cn } from '@/lib/utils';

export interface AuditRowView {
  id: string;
  slug: string;
  url: string;
  host: string;
  name: string;
  label: string | null;
  source: string;
  status: DisplayStatus;
  score: number | null;
  createdAt: string;
  createdLabel: string;
  pages: number | null;
  weakAxes: AuditAxis[];
  /** Axes disabled for this audit ("Non évalué"), empty when all ran. */
  notEvaluated: AuditAxis[];
  /** Préparation IA (optional module), null while the audit is not finished. */
  aiScore: AiScoreView | null;
  trackingToken: string | null;
  opened: boolean;
  views: number;
  lastViewedAt: string | null;
  faviconUrl: string | null;
  heroUrl: string | null;
  /** Score change since the previous scan, on 100. */
  delta: number | null;
  axes: AxisBar[];
  progressStep: ProgressStep | null;
  /** Opened in the last 24 hours. */
  recentlyOpened: boolean;
}

interface Props {
  rows: AuditRowView[];
  publicUrl: string;
  highlightId: string | null;
  /** Audit whose side panel is open. */
  selectedId?: string | null;
  /** Current list query string ("?vue=…"), kept when opening a panel. */
  query?: string;
  fadeTail: boolean;
}

const BAND_MARK: Record<'good' | 'fair' | 'poor', string> = {
  good: 'bg-[var(--success)]',
  fair: 'bg-[var(--warning)]',
  poor: 'bg-[var(--danger)]',
};

/** The one colored marker of a score: a 6 px square in the band color. */
export function BandMark({ value }: { value: number }): React.ReactElement {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-[2px]', BAND_MARK[scoreBand(value)])}
    />
  );
}

/**
 * Status in words. The normal state (done) stays quiet; a dot only marks
 * what needs an eye: running (accent) and failed (danger).
 */
export function StatusPill({ status }: { status: DisplayStatus }): React.ReactElement {
  return (
    <span
      title={STATUS_LABEL[status]}
      className={cn(
        'block max-w-full truncate whitespace-nowrap text-[13px]',
        status === 'failed' && 'font-medium text-[var(--danger)]',
        (status === 'completed' || status === 'expired') && 'text-[var(--fg-muted)]',
      )}
    >
      {status === 'running' ? (
        <span
          aria-hidden="true"
          className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)] align-middle"
        />
      ) : status === 'failed' ? (
        <span
          aria-hidden="true"
          className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--danger)] align-middle"
        />
      ) : null}
      {STATUS_LABEL[status]}
    </span>
  );
}

/** Préparation IA score: separate from the global score, "Non évalué" when the module was off. */
function AiScore({ view }: { view: AiScoreView | null }): React.ReactElement {
  if (view === null || view.state === 'off') {
    return (
      <span className="text-[var(--fg-muted)]" title="Préparation IA non évaluée">
        <span aria-hidden="true">-</span>
        <span className="sr-only">Préparation IA non évaluée</span>
      </span>
    );
  }
  if (view.state === 'failed') {
    return (
      <span className="text-[var(--fg-muted)]" title="Préparation IA : site injoignable">
        <span aria-hidden="true">?</span>
        <span className="sr-only">Préparation IA non mesurée, site injoignable</span>
      </span>
    );
  }
  const band = scoreBand(view.value);
  return (
    <span
      className="tabular-nums text-[var(--fg-muted)]"
      title={`Préparation IA : ${String(view.value)}/100, hors score global par défaut`}
    >
      {view.value}
      <span className="sr-only"> sur 100 en préparation IA ({SCORE_BAND_LABEL[band]})</span>
    </span>
  );
}

function Score({
  value,
  notEvaluated = [],
}: {
  value: number | null;
  notEvaluated?: AuditAxis[];
}): React.ReactElement {
  if (value === null)
    return (
      <span className="text-[var(--fg-muted)]" aria-label="Pas de score">
        -
      </span>
    );
  const band = scoreBand(value);
  const partial = notEvaluated.length > 0;
  return (
    <span
      className="inline-flex items-center gap-2 tabular-nums"
      title={
        partial
          ? `${String(value)}/100, calculé sans les axes non évalués : ${notEvaluated.map((a) => AXIS_LONG[a]).join(', ')}`
          : `${String(value)}/100, ${SCORE_BAND_LABEL[band]}`
      }
    >
      <BandMark value={value} />
      <span className="font-medium">
        {value}
        {partial ? (
          <span aria-hidden="true" className="text-[var(--fg-muted)]">
            *
          </span>
        ) : null}
      </span>
      <span className="sr-only">
        {' '}
        sur 100 ({SCORE_BAND_LABEL[band]}
        {partial
          ? `, sur ${String(8 - notEvaluated.length)} axes, non évalués : ${notEvaluated.map((a) => AXIS_LONG[a]).join(', ')}`
          : ''}
        )
      </span>
    </span>
  );
}

function Opened({ row }: { row: AuditRowView }): React.ReactElement {
  if (row.trackingToken === null) return <span className="text-[var(--fg-muted)]">-</span>;
  return row.opened ? (
    <span
      className="tabular-nums"
      title={
        row.lastViewedAt
          ? `Dernière ouverture : ${new Date(row.lastViewedAt).toLocaleString('fr-FR')}`
          : undefined
      }
    >
      {row.views > 1 ? `${String(row.views)} fois` : 'Oui'}
    </span>
  ) : (
    <span className="text-[var(--fg-muted)]">Pas encore</span>
  );
}

/** Favicon, or the site initial on a neutral square (no gradient). */
export function SiteIcon({
  seed,
  faviconUrl,
  size = 18,
}: {
  seed: string;
  faviconUrl: string | null;
  size?: number;
}): React.ReactElement {
  const [failed, setFailed] = useState(false);
  if (faviconUrl && !failed) {
    return (
      <img
        src={faviconUrl}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => {
          setFailed(true);
        }}
        className="shrink-0 rounded-[4px] object-contain"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex shrink-0 items-center justify-center rounded-[4px] border border-[var(--border-strong)] bg-[var(--bg-subtle)] font-medium text-[var(--fg-muted)]"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.55) }}
    >
      {seed
        .replace(/^www\./, '')
        .charAt(0)
        .toUpperCase()}
    </span>
  );
}

/** Score change since the last scan: arrow + sign + value, in text color. */
export function Delta({ value }: { value: number | null }): React.ReactElement | null {
  if (value === null || value === 0) return null;
  const up = value > 0;
  return (
    <span
      className="ml-2 inline-flex items-center text-[12px] tabular-nums text-[var(--fg-muted)]"
      title="Depuis le scan précédent"
    >
      <span aria-hidden="true">{up ? '↑' : '↓'}</span>
      {up ? '+' : ''}
      {value}
      <span className="sr-only"> points depuis le scan précédent</span>
    </span>
  );
}

/** 8 thin bars, one per axis (height = score), one neutral tone. Values in the title and for screen readers. */
export function AxisMiniBars({ axes }: { axes: AxisBar[] }): React.ReactElement {
  if (axes.length === 0) return <span className="text-[var(--fg-muted)]">-</span>;
  const summary = axes
    .map((a) => `${a.label} ${a.value === null ? 'non évalué' : String(a.value)}`)
    .join(', ');
  return (
    <span className="flex h-4 items-end gap-[2px]" title={summary}>
      {axes.map((a) => (
        <span
          key={a.axis}
          aria-hidden="true"
          className={cn(
            'w-[3px] rounded-[1px]',
            a.value === null ? 'bg-[var(--viz-mute-2)]' : 'bg-[var(--viz-mute-1)]',
          )}
          style={{ height: `${String(a.value === null ? 12 : Math.max(10, a.value))}%` }}
        />
      ))}
      <span className="sr-only">Scores par axe : {summary}</span>
    </span>
  );
}

/** Live step of a running audit: a dot, the step in words, the count. */
export function Progress({ step }: { step: ProgressStep }): React.ReactElement {
  const order: ProgressStep[] = ['loading', 'analysis', 'writing'];
  const at = Math.max(order.indexOf(step), 0);
  return (
    <span
      title={`${PROGRESS_LABEL[step]} ${String(at + 1)}/3`}
      className="block max-w-full truncate whitespace-nowrap text-[13px]"
      aria-live="polite"
    >
      <span
        aria-hidden="true"
        className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--accent)] align-middle"
      />
      {PROGRESS_LABEL[step]}{' '}
      <span className="tabular-nums text-[var(--fg-muted)]">
        <span aria-hidden="true">{at + 1}/3</span>
        <span className="sr-only">, étape {String(at + 1)} sur 3</span>
      </span>
    </span>
  );
}

function Th({
  children,
  className,
  width,
}: {
  children: React.ReactNode;
  className?: string;
  /** Column width (table-layout: fixed reads it from the header row). */
  width?: string;
}): React.ReactElement {
  return (
    <th
      scope="col"
      style={width ? { width } : undefined}
      className={cn(
        'h-9 overflow-hidden whitespace-nowrap border-b border-[var(--border)] px-3 text-left text-[12px] font-medium text-[var(--fg-muted)]',
        className,
      )}
    >
      {children}
    </th>
  );
}

interface Announce {
  text: string;
  ok: boolean;
}

export function AuditsTable({
  rows: serverRows,
  publicUrl,
  highlightId,
  selectedId = null,
  query = '',
  fadeTail,
}: Props): React.ReactElement {
  const router = useRouter();
  const panelHref = (id: string): string => `/dashboard/audits/${id}${query}`;
  // A click anywhere on a row opens its panel, except on its own controls.
  const openRow = (e: React.MouseEvent, id: string): void => {
    const t = e.target as HTMLElement;
    if (t.closest('a,button,input,[role="menuitem"],[data-radix-popper-content-wrapper]')) return;
    if (window.getSelection()?.toString()) return;
    router.push(panelHref(id) as '/dashboard', { scroll: false });
  };
  // Optimistic state (see optimistic.ts): deleted rows disappear at once
  // and never come back from a late auto-refresh render.
  const [removed, setRemoved] = useState<ReadonlySet<string>>(new Set());
  const [refreshing, setRefreshing] = useState<ReadonlySet<string>>(new Set());
  const rows = useMemo(
    () => applyOptimistic(serverRows, removed, refreshing),
    [serverRows, removed, refreshing],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null);
  const [announce, setAnnounce] = useState<Announce | null>(null);
  const [pending, startTransition] = useTransition();
  const headerBox = useRef<HTMLInputElement>(null);

  // Drop selections of rows that left the page.
  const ids = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => ids.has(id))));
  }, [ids]);

  const allSelected = rows.length > 0 && selected.size === rows.length;
  useEffect(() => {
    if (headerBox.current) headerBox.current.indeterminate = selected.size > 0 && !allSelected;
  }, [selected, allSelected]);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const mutate = (kind: 'delete' | 'refresh', list: string[]): void => {
    const setOpt = kind === 'delete' ? setRemoved : setRefreshing;
    const action: (ids: string[]) => Promise<BulkResult> =
      kind === 'delete' ? deleteAuditsAction : refreshAuditsAction;
    setOpt((prev) => new Set([...prev, ...list]));
    setSelected(new Set());
    const release = beginMutation();
    startTransition(async () => {
      let res: BulkResult;
      try {
        res = await action(list);
      } catch {
        res = {
          ok: false,
          done: 0,
          skipped: 0,
          failed: list.length,
          message: 'Action impossible pour le moment.',
        };
      }
      const failed = new Set(res.failedIds ?? (res.ok ? [] : list));
      if (failed.size > 0) {
        setOpt((prev) => new Set([...prev].filter((id) => !failed.has(id))));
      }
      setAnnounce({ text: res.message, ok: res.ok });
      release();
      router.refresh();
    });
  };

  const copy = (row: AuditRowView): void => {
    const url = reportUrl(publicUrl, { tracking_token: row.trackingToken, slug: row.slug });
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setAnnounce({ text: `Lien de ${row.name} copié.`, ok: true });
      })
      .catch(() => {
        setAnnounce({ text: `Copie impossible. Le lien : ${url}`, ok: false });
      });
  };

  useEffect(() => {
    if (announce === null) return;
    const t = window.setTimeout(() => {
      setAnnounce(null);
    }, 6_000);
    return () => {
      window.clearTimeout(t);
    };
  }, [announce]);

  const confirmRows = rows.filter((r) => confirmIds?.includes(r.id));

  return (
    <div className="relative">
      {selected.size > 0 ? (
        <div
          role="region"
          aria-label="Actions groupées"
          className="sticky top-12 z-20 flex flex-wrap items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-subtle)] px-4 py-2 text-[13px]"
        >
          <span className="font-medium">
            {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
          </span>
          <DashButton
            size="sm"
            disabled={pending}
            onClick={() => {
              mutate('refresh', [...selected]);
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Rafraîchir
          </DashButton>
          <DashButton size="sm" asChild>
            <a href={`/api/dashboard/export?ids=${[...selected].join(',')}`} download>
              <Download className="h-3.5 w-3.5" aria-hidden="true" /> Exporter
            </a>
          </DashButton>
          <DashButton
            size="sm"
            disabled={pending}
            className="text-[var(--danger)]"
            onClick={() => {
              setConfirmIds([...selected]);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Supprimer
          </DashButton>
          <DashButton
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelected(new Set());
            }}
          >
            Annuler
          </DashButton>
        </div>
      ) : null}

      {/* >= 640 px: real table */}
      {/* Fixed layout: column widths come from the header row, every cell
          clips (long values end with an ellipsis and carry a title), and the
          table keeps a minimum width per breakpoint so the Site column never
          collapses; the scroll container is only a last resort. */}
      <div className="overflow-x-auto max-sm:hidden">
        <table
          className={cn(
            'w-full min-w-[600px] table-fixed border-collapse text-[13px] md:min-w-[760px] lg:min-w-[800px] 2xl:min-w-[1260px]',
            '[&_td]:overflow-hidden [&_td]:text-ellipsis [&_td]:whitespace-nowrap',
            fadeTail && 'dash-fade-tail',
          )}
        >
          <caption className="sr-only">
            Liste des audits. Colonnes : site, domaine, score, préparation IA, statut, date, scores
            par axe, source, ouverture du lien. Choisis un site pour ouvrir sa fiche.
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                style={{ width: '40px' }}
                className="h-9 border-b border-[var(--border)] pl-4 pr-1 text-left"
              >
                <input
                  ref={headerBox}
                  type="checkbox"
                  aria-label="Tout sélectionner"
                  checked={allSelected}
                  onChange={() => {
                    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
                  }}
                  className="h-3.5 w-3.5 accent-[var(--accent)]"
                />
              </th>
              <Th>
                Site <span className="tabular-nums">({rows.length})</span>
              </Th>
              <Th width="18%">Domaine</Th>
              <Th width="104px">Score</Th>
              <Th className="max-lg:hidden" width="80px">
                IA
              </Th>
              {/* Sized for the longest label, "Chargement 3/3". */}
              <Th width="152px">Statut</Th>
              <Th className="max-md:hidden" width="148px">
                Créé le
              </Th>
              <Th className="max-2xl:hidden" width="96px">
                Axes
              </Th>
              <Th className="max-2xl:hidden" width="140px">
                Source
              </Th>
              <Th className="max-md:hidden" width="120px">
                Ouvert
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                onClick={(e) => {
                  openRow(e, row.id);
                }}
                aria-selected={selectedId === row.id}
                className={cn(
                  'group h-11 cursor-pointer border-b border-[var(--border)] hover:bg-[var(--bg-subtle)]',
                  selected.has(row.id) && 'bg-[var(--bg-subtle)]',
                  highlightId === row.id && 'bg-[var(--accent-soft)]',
                  selectedId === row.id && 'dash-row-selected',
                )}
              >
                <td className="pl-4 pr-1">
                  <input
                    type="checkbox"
                    aria-label={`Sélectionner ${row.name}`}
                    checked={selected.has(row.id)}
                    onChange={() => {
                      toggle(row.id);
                    }}
                    className="h-3.5 w-3.5 accent-[var(--accent)]"
                  />
                </td>
                <td className="px-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <SitePreview heroUrl={row.heroUrl}>
                      <SiteIcon seed={row.host} faviconUrl={row.faviconUrl} />
                      <Link
                        href={panelHref(row.id) as '/dashboard'}
                        scroll={false}
                        className="truncate font-medium hover:underline"
                        title={row.name}
                        aria-current={selectedId === row.id ? 'true' : undefined}
                      >
                        {row.name}
                      </Link>
                    </SitePreview>
                    {row.recentlyOpened ? (
                      <span className="dash-pulse" title="Ouvert dans les dernières 24 h">
                        <span className="sr-only">Ouvert dans les dernières 24 h</span>
                      </span>
                    ) : null}
                    <RowMenu
                      row={row}
                      onCopy={copy}
                      onRefresh={() => {
                        mutate('refresh', [row.id]);
                      }}
                      onDelete={() => {
                        setConfirmIds([row.id]);
                      }}
                    />
                  </div>
                </td>
                <td className="truncate px-3" title={row.host}>
                  <a
                    href={previewPath({ tracking_token: row.trackingToken, slug: row.slug })}
                    target="_blank"
                    rel="noopener"
                    className="dash-link"
                    title={
                      row.pages !== null ? `${String(row.pages)} page(s) analysée(s)` : undefined
                    }
                  >
                    {row.host}
                    <span className="sr-only"> (ouvre le rapport dans un nouvel onglet)</span>
                  </a>
                </td>
                <td className="whitespace-nowrap px-3">
                  <Score value={row.score} notEvaluated={row.notEvaluated} />
                  <Delta value={row.delta} />
                </td>
                <td className="whitespace-nowrap px-3 max-lg:hidden">
                  <AiScore view={row.aiScore} />
                </td>
                <td className="px-3">
                  {row.progressStep !== null && row.progressStep !== 'queued' ? (
                    <Progress step={row.progressStep} />
                  ) : (
                    <StatusPill status={row.status} />
                  )}
                </td>
                <td
                  className="whitespace-nowrap px-3 tabular-nums text-[var(--fg-muted)] max-md:hidden"
                  title={row.createdLabel}
                >
                  <time dateTime={row.createdAt}>{row.createdLabel}</time>
                </td>
                <td className="px-3 max-2xl:hidden">
                  <AxisMiniBars axes={row.axes} />
                </td>
                <td
                  className="truncate px-3 text-[var(--fg-muted)] max-2xl:hidden"
                  title={SOURCE_LABEL[row.source] ?? row.source}
                >
                  {SOURCE_LABEL[row.source] ?? row.source}
                </td>
                <td className="whitespace-nowrap px-3 max-md:hidden">
                  <Opened row={row} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* < 640 px: stacked list */}
      <ul className="sm:hidden" aria-label="Audits">
        {rows.map((row) => (
          <li
            key={row.id}
            className={cn(
              'flex items-start gap-3 border-b border-[var(--border)] px-4 py-3',
              highlightId === row.id && 'bg-[var(--accent-soft)]',
            )}
          >
            <input
              type="checkbox"
              aria-label={`Sélectionner ${row.name}`}
              checked={selected.has(row.id)}
              onChange={() => {
                toggle(row.id);
              }}
              className="mt-1 h-4 w-4 accent-[var(--accent)]"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <SiteIcon seed={row.host} faviconUrl={row.faviconUrl} />
                <Link
                  href={panelHref(row.id) as '/dashboard'}
                  scroll={false}
                  className="truncate text-[14px] font-medium"
                >
                  {row.name}
                </Link>
                <span className="ml-auto">
                  <Score value={row.score} notEvaluated={row.notEvaluated} />
                </span>
              </div>
              <a
                href={previewPath({ tracking_token: row.trackingToken, slug: row.slug })}
                target="_blank"
                rel="noopener"
                className="mt-0.5 block truncate text-[13px] dash-link"
              >
                {row.host}
              </a>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-[var(--fg-muted)]">
                <StatusPill status={row.status} />
                <time dateTime={row.createdAt}>{row.createdLabel}</time>
                {row.pages !== null ? (
                  <span>
                    {row.pages} page{row.pages > 1 ? 's' : ''}
                  </span>
                ) : null}
                {row.aiScore !== null && row.aiScore.state === 'scored' ? (
                  <span>
                    IA <AiScore view={row.aiScore} />
                  </span>
                ) : null}
                <Opened row={row} />
              </div>
            </div>
            <RowMenu
              row={row}
              onCopy={copy}
              onRefresh={() => {
                mutate('refresh', [row.id]);
              }}
              onDelete={() => {
                setConfirmIds([row.id]);
              }}
            />
          </li>
        ))}
      </ul>

      <div
        aria-live="polite"
        role="status"
        className="pointer-events-none fixed bottom-4 right-4 z-50"
      >
        {announce !== null ? (
          <p
            className={cn(
              'pointer-events-auto rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[13px] shadow-[var(--shadow-pop)]',
              announce.ok ? '' : 'text-[var(--danger)]',
            )}
          >
            {announce.text}
          </p>
        ) : null}
      </div>

      <Dialog
        open={confirmIds !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmIds(null);
        }}
      >
        <DialogContent>
          <DialogTitle>
            {confirmRows.length > 1
              ? `Supprimer ${String(confirmRows.length)} audits ?`
              : `Supprimer l’audit de ${confirmRows[0]?.name ?? 'ce site'} ?`}
          </DialogTitle>
          <DialogDescription>
            Le rapport, ses liens de suivi et ses captures sont effacés. Les liens déjà envoyés ne
            marcheront plus. Tu ne pourras pas revenir en arrière.
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <DialogClose asChild>
              <DashButton>Annuler</DashButton>
            </DialogClose>
            <DashButton
              variant="danger"
              disabled={pending}
              onClick={() => {
                const list = confirmIds ?? [];
                setConfirmIds(null);
                mutate('delete', list);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              Supprimer
            </DashButton>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RowMenu({
  row,
  onCopy,
  onRefresh,
  onDelete,
}: {
  row: AuditRowView;
  onCopy: (row: AuditRowView) => void;
  onRefresh: () => void;
  onDelete: () => void;
}): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] data-[state=open]:bg-[var(--bg-hover)]"
        aria-label={`Actions pour ${row.name}`}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem asChild>
          <a
            href={previewPath({ tracking_token: row.trackingToken, slug: row.slug })}
            target="_blank"
            rel="noopener"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" /> Ouvrir le rapport
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild disabled={row.status !== 'completed'}>
          <a href={`/api/audits/full/${row.slug}/pdf`} download>
            <Download className="h-4 w-4" aria-hidden="true" /> Télécharger le PDF
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onCopy(row);
          }}
        >
          <Copy className="h-4 w-4" aria-hidden="true" /> Copier le lien
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRefresh} disabled={row.status === 'running'}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Rafraîchir
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={onDelete}>
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Supprimer
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
