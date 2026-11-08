import type { ApiAnalyticsSummary } from '@mynto/shared';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Topbar } from '../_components/Topbar';

import {
  DataTable,
  HBars,
  Legend,
  Panel,
  SegmentedBar,
  StackedColumns,
  StatTile,
} from './_components/charts';

import {
  PERIODS,
  compact,
  duration,
  parsePeriod,
  percent,
  shortDay,
} from '@/lib/dashboard/analytics';
import { AXIS_LONG, SOURCE_LABEL } from '@/lib/dashboard/format';
import { SCORE_BAND_LABEL, scoreBand } from '@/lib/scores';
import { ServiceError, analyticsSummary } from '@/lib/services/audits';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Analytics' };

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** Emphasis form (dataviz): the finished audits in the accent, the rest in the neutral step. */
const STATUS_SERIES = [
  { key: 'completed', label: 'Terminés', color: 'var(--viz-1)' },
  { key: 'other', label: 'Échecs ou en cours', color: 'var(--viz-mute-1)' },
];

const BAND_LABEL = {
  good: 'Bon (80 et plus)',
  fair: 'À améliorer (50 à 79)',
  poor: 'Critique (moins de 50)',
};
const BAND_COLOR = { good: 'var(--viz-ord-3)', fair: 'var(--viz-ord-2)', poor: 'var(--viz-ord-1)' };

export default async function AnalyticsPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const days = parsePeriod((await searchParams).jours);
  let s: ApiAnalyticsSummary | null = null;
  let error: string | null = null;
  try {
    s = await analyticsSummary(days);
  } catch (err) {
    error = err instanceof ServiceError ? err.message : 'Statistiques indisponibles.';
  }

  return (
    <>
      <Topbar crumbs={[{ label: 'Analytics' }, { label: `${String(days)} derniers jours` }]} />
      <main id="main" className="min-w-0 flex-1 px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-10">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="dash-display">Analytics</h1>
              <p className="mt-1 text-[13px] text-[var(--fg-muted)]">
                Tes audits, leurs scores et l’ouverture des liens envoyés. Les axes non évalués ne
                comptent pas dans les moyennes.
              </p>
            </div>
            <nav aria-label="Période">
              <ul className="inline-flex gap-0.5">
                {PERIODS.map((p) => (
                  <li key={p}>
                    <Link
                      href={`/dashboard/analytics?jours=${String(p)}` as '/dashboard'}
                      aria-current={p === days ? 'page' : undefined}
                      className={cn(
                        'inline-flex h-7 items-center rounded px-2.5 text-[13px]',
                        p === days
                          ? 'bg-[var(--bg-subtle)] font-medium text-[var(--fg)]'
                          : 'text-[var(--fg-muted)] hover:text-[var(--fg)]',
                      )}
                    >
                      {p} jours
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          </div>

          {s === null ? (
            <p role="alert" className="dash-note dash-note--danger">
              {error}
            </p>
          ) : (
            <Dashboard s={s} />
          )}
        </div>
      </main>
    </>
  );
}

function Dashboard({ s }: { s: ApiAnalyticsSummary }): React.ReactElement {
  const axisMax = 100;
  const axesRows = s.axes.map((a) => ({
    key: a.axis,
    label: AXIS_LONG[a.axis],
    value: a.average === null ? null : Math.round(a.average),
    title:
      a.average === null
        ? undefined
        : `${AXIS_LONG[a.axis]} : ${String(Math.round(a.average))}/100 sur ${String(a.audits)} audit(s)`,
  }));
  const sourceMax = Math.max(1, ...s.sources.map((x) => x.count));
  const findingMax = Math.max(1, ...s.top_findings.map((f) => f.count));
  const bandTotal = s.score_bands.reduce((n, b) => n + b.count, 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label="Audits lancés"
          value={compact(s.audits.total)}
          detail={`${String(s.audits.completed)} terminés, ${String(s.audits.failed)} en échec`}
        />
        <StatTile
          label="Score moyen"
          value={s.average_score === null ? '-' : `${String(Math.round(s.average_score))}/100`}
          detail="Sur les audits terminés"
        />
        <StatTile
          label="Liens ouverts"
          value={percent(s.links.open_rate)}
          detail={`${String(s.links.opened)} sur ${String(s.links.total)} lien${s.links.total > 1 ? 's' : ''}`}
        />
        <StatTile
          label="Délai avant ouverture"
          value={duration(s.links.median_hours_to_first_open)}
          detail="Médiane, première ouverture"
        />
        <StatTile
          label="Appels IA"
          value={compact(s.llm.calls + s.llm.vision_calls)}
          detail={`${compact(s.llm.tokens_in + s.llm.tokens_out)} jetons de rédaction`}
        />
      </div>

      <div className="grid gap-x-10 gap-y-10 lg:grid-cols-3">
        <Panel
          id="weekly"
          title="Audits par semaine"
          subtitle="Par statut, semaines du lundi au dimanche"
          className="lg:col-span-2"
          table={
            <DataTable
              caption="Audits par semaine et par statut"
              head={['Semaine du', 'Terminés', 'Échecs', 'En cours']}
              rows={s.weekly.map((w) => [
                shortDay(w.week_start),
                w.completed,
                w.failed,
                w.in_progress,
              ])}
            />
          }
        >
          <div className="space-y-3">
            <Legend items={STATUS_SERIES} />
            <StackedColumns
              data={s.weekly.map((w) => ({
                week_start: w.week_start,
                completed: w.completed,
                other: w.failed + w.in_progress,
              }))}
              series={STATUS_SERIES}
              label={`Audits par semaine sur ${String(s.period_days)} jours, ${String(s.audits.total)} au total. Détail dans le tableau.`}
            />
          </div>
        </Panel>

        <Panel
          id="bands"
          title="Répartition des scores"
          subtitle={`${String(bandTotal)} audit${bandTotal > 1 ? 's' : ''} terminé${bandTotal > 1 ? 's' : ''}`}
          table={
            <DataTable
              caption="Audits terminés par tranche de score"
              head={['Tranche', 'Audits']}
              rows={s.score_bands.map((b) => [BAND_LABEL[b.band], b.count])}
            />
          }
        >
          <SegmentedBar
            label={`Répartition des scores : ${s.score_bands.map((b) => `${BAND_LABEL[b.band]} ${String(b.count)}`).join(', ')}`}
            parts={s.score_bands.map((b) => ({
              key: b.band,
              label: BAND_LABEL[b.band],
              value: b.count,
              color: BAND_COLOR[b.band],
            }))}
          />
        </Panel>
      </div>

      <div className="grid gap-x-10 gap-y-10 lg:grid-cols-2">
        <Panel
          id="axes"
          title="Score moyen par axe"
          subtitle="Sur 100, audits terminés où l’axe a été évalué"
          table={
            <DataTable
              caption="Score moyen par axe"
              head={['Axe', 'Score moyen', 'Audits']}
              rows={s.axes.map((a) => [
                AXIS_LONG[a.axis],
                a.average === null ? 'Non évalué' : Math.round(a.average),
                a.audits,
              ])}
            />
          }
        >
          <HBars
            rows={axesRows}
            max={axisMax}
            emptyLabel="Non évalué sur la période"
            tone={(v) => (scoreBand(v) === 'good' ? 'var(--viz-1)' : 'var(--warning)')}
            note={(v) => SCORE_BAND_LABEL[scoreBand(v)]}
          />
        </Panel>

        <Panel
          id="findings"
          title="Problèmes les plus fréquents"
          subtitle="Nombre d’audits concernés"
          table={
            <DataTable
              caption="Problèmes les plus fréquents"
              head={['Problème', 'Code', 'Audits']}
              rows={s.top_findings.map((f) => [f.label, f.rule_code, f.count])}
            />
          }
        >
          {s.top_findings.length === 0 ? (
            <p className="text-[13px] text-[var(--fg-muted)]">
              Aucun problème relevé sur la période.
            </p>
          ) : (
            <HBars
              max={findingMax}
              rows={s.top_findings.map((f) => ({
                key: f.rule_code,
                label: f.label,
                value: f.count,
                title: `${f.label} (${f.rule_code}) : ${String(f.count)} audit(s)`,
              }))}
            />
          )}
        </Panel>
      </div>

      <AiReadinessPanels s={s} />

      <div className="grid gap-x-10 gap-y-10 lg:grid-cols-2">
        <Panel
          id="sources"
          title="Origine des audits"
          subtitle="Tableau de bord, Radar, API ou MCP"
          table={
            <DataTable
              caption="Audits par origine"
              head={['Origine', 'Audits']}
              rows={s.sources.map((x) => [SOURCE_LABEL[x.source] ?? x.source, x.count])}
            />
          }
        >
          {s.sources.length === 0 ? (
            <p className="text-[13px] text-[var(--fg-muted)]">Aucun audit sur la période.</p>
          ) : (
            <HBars
              max={sourceMax}
              rows={s.sources.map((x) => ({
                key: x.source,
                label: SOURCE_LABEL[x.source] ?? x.source,
                value: x.count,
              }))}
            />
          )}
        </Panel>

        <Panel
          id="llm"
          title="Usage de l’IA"
          subtitle="Estimation à partir des audits de la période"
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            {[
              ['Rapports rédigés', compact(s.llm.calls)],
              ['Analyses visuelles', compact(s.llm.vision_calls)],
              ['Jetons envoyés', compact(s.llm.tokens_in)],
              ['Jetons reçus', compact(s.llm.tokens_out)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] text-[var(--fg-muted)]">{k}</dt>
                <dd className="mt-0.5 dash-num text-[22px]">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-[12px] text-[var(--fg-muted)]">
            Les jetons des analyses visuelles ne sont pas mesurés. Le coût exact se lit chez ton
            fournisseur.
          </p>
        </Panel>
      </div>
    </>
  );
}

/** Préparation IA (optional module): average score and the tests that fail most. */
function AiReadinessPanels({ s }: { s: ApiAnalyticsSummary }): React.ReactElement {
  const ai = s.ai_readiness;
  const max = Math.max(1, ...ai.top_failed_checks.map((c) => c.count));
  return (
    <div className="grid gap-x-10 gap-y-10 lg:grid-cols-3">
      <Panel
        id="ai-readiness"
        title="Préparation IA"
        subtitle="Audits terminés avec le module, sur 100"
      >
        {ai.audits === 0 ? (
          <p className="text-[13px] text-[var(--fg-muted)]">
            Aucun audit avec la préparation IA sur la période. Active le module dans Réglages,
            Modules d’audit, ou au lancement d’un audit.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[13px]">
            <div>
              <dt className="text-[12px] text-[var(--fg-muted)]">Score IA moyen</dt>
              <dd className="mt-0.5 dash-num text-[22px]">
                {ai.average_score === null ? '-' : `${String(Math.round(ai.average_score))}/100`}
              </dd>
            </div>
            <div>
              <dt className="text-[12px] text-[var(--fg-muted)]">Audits évalués</dt>
              <dd className="mt-0.5 dash-num text-[22px]">{compact(ai.audits)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[12px] text-[var(--fg-muted)]">Préparation IA faible</dt>
              <dd className="mt-0.5">
                <Link
                  href={'/dashboard/audits?ia=faible' as '/dashboard'}
                  className="text-[16px] font-semibold tabular-nums dash-link"
                >
                  {compact(ai.low_count)} audit{ai.low_count > 1 ? 's' : ''}
                </Link>
                <span className="ml-1.5 text-[12px] text-[var(--fg-muted)]">sous 50/100</span>
              </dd>
            </div>
          </dl>
        )}
      </Panel>
      <Panel
        id="ai-failed"
        title="Tests IA les plus échoués"
        subtitle="Nombre d’audits concernés"
        className="lg:col-span-2"
        table={
          <DataTable
            caption="Tests de préparation IA les plus échoués"
            head={['Test', 'Code', 'Audits']}
            rows={ai.top_failed_checks.map((c) => [c.label, c.rule_code, c.count])}
          />
        }
      >
        {ai.top_failed_checks.length === 0 ? (
          <p className="text-[13px] text-[var(--fg-muted)]">Aucun test échoué sur la période.</p>
        ) : (
          <HBars
            max={max}
            rows={ai.top_failed_checks.map((c) => ({
              key: c.rule_code,
              label: c.label,
              value: c.count,
              title: `${c.label} (${c.rule_code}) : ${String(c.count)} audit(s)`,
            }))}
          />
        )}
      </Panel>
    </div>
  );
}
