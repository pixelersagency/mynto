import { DEFAULT_EMAIL_BODY, DEFAULT_EMAIL_SUBJECT, fillEmailTemplate } from '@mynto/db';
import { parseStoredModules, type AuditAxis } from '@mynto/shared';
import { resolveTemplateAlias } from '@mynto/templates';
import Link from 'next/link';

import { SiteIcon, StatusPill, Progress } from '../../_components/AuditsTable';
import { AxisRadar, ScoreFigure, ScoreSparkline, type RadarAxis } from '../../_components/viz';

import { PanelActions } from './PanelActions';
import { TemplatePicker } from './TemplatePicker';

import { getBranding } from '@/lib/branding';
import {
  AXIS_LONG,
  AXIS_SHORT,
  SOURCE_LABEL,
  axisBars,
  displayStatus,
  longDate,
  previewPath,
  reportUrl,
  scoreDelta,
  siteName,
  type ProgressStep,
} from '@/lib/dashboard/format';
import { db, pgErrorCode } from '@/lib/db';
import { publicUrl } from '@/lib/env';
import { logger } from '@/lib/logger';
import { listTemplates } from '@/lib/reports/templates';
import { hostOf, score100 } from '@/lib/scores';

const SEVERITY_LABEL: Record<string, string> = { P0: 'Critique', P1: 'Important' };

function dateTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

function Section({
  title,
  children,
  aside,
}: {
  title: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="px-5 py-6">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="dash-label">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Content of the audit record (server). The shell (keys, motion) is PanelShell. */
export async function AuditPanel({
  id,
}: {
  id: string;
  raw: Record<string, string | string[] | undefined>;
}): Promise<React.ReactElement> {
  let data;
  try {
    const [list, history, opens, top, extra, sends, smtp, templates, reportSettings, brand] =
      await Promise.all([
        db().dashboard.listAudits({ ids: [id], limit: 1 }),
        db().dashboard.history(id),
        db().dashboard.opens(id, 8),
        db().dashboard.topFindings(id, 6),
        db().dashboard.detailExtra(id),
        db().email.listSends(id, 6),
        db().email.getSmtp(),
        listTemplates(),
        db().reports.getSettings(),
        getBranding(),
      ]);
    data = {
      row: list.rows[0],
      history,
      opens,
      top,
      extra,
      sends,
      smtp,
      templates,
      reportSettings,
      brand,
    };
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'audit_panel_failed');
    return (
      <p role="alert" className="p-5 text-[13px] text-[var(--danger)]">
        Impossible de charger cette fiche. Vérifie la connexion à la base de données.
      </p>
    );
  }
  const { row, history, opens, top, extra, sends, smtp, templates, reportSettings, brand } = data;
  if (!row) {
    return (
      <div className="p-5">
        <h2 className="dash-heading">Audit introuvable</h2>
        <p className="mt-1 text-[13px] text-[var(--fg-muted)]">
          Il a été supprimé ou remplacé par un scan plus récent.
        </p>
      </div>
    );
  }

  const status = displayStatus(row.status, row.expires_at);
  const name = siteName(row.url, row.label);
  const host = hostOf(row.url);
  const score = status === 'completed' || status === 'expired' ? score100(row.global_score) : null;
  const delta = scoreDelta(row.global_score, row.prev_score);
  const modules = row.modules === null ? null : parseStoredModules(row.modules);
  const bars = axisBars(row.axis_scores, row.modules);
  const radar: RadarAxis[] = bars.map((b) => ({
    key: b.axis,
    short: AXIS_SHORT[b.axis],
    label: b.label,
    value: b.value,
  }));
  if (row.ai_score !== null && row.ai_status === 'completed') {
    radar.push({ key: 'ia', short: 'IA', label: 'Préparation IA', value: row.ai_score });
  }
  const shareLink = reportUrl(publicUrl(), { tracking_token: row.tracking_token, slug: row.slug });
  const preview = previewPath({ tracking_token: row.tracking_token, slug: row.slug });
  const historyPoints = history
    .filter((h) => h.status === 'completed' && h.global_score !== null)
    .map((h) => ({
      date: h.created_at,
      label: longDate(h.created_at),
      value: score100(h.global_score) ?? 0,
    }));
  const smtpReady = smtp !== null;
  const vars = {
    site: host,
    score: String(score ?? '-'),
    lien: '{lien}',
    agence: brand.name,
  };
  const enabledTemplates = templates.filter((t) => t.enabled || t.id === row.template_id);
  const defaultTemplate = templates.find(
    (t) => t.id === resolveTemplateAlias(reportSettings.default_template_id),
  );
  const progress: ProgressStep | null =
    status === 'running'
      ? row.status === 'queued'
        ? 'queued'
        : ((row.progress_step as ProgressStep | null) ?? 'loading')
      : null;

  return (
    <div className="flex min-h-full flex-col">
      <header className="px-5 pb-4 pt-5">
        <div className="flex items-start gap-3">
          <SiteIcon
            seed={host}
            faviconUrl={row.favicon_key ? `/media/${row.favicon_key}` : null}
            size={28}
          />
          <div className="min-w-0 flex-1">
            <h2 id="panel-title" tabIndex={-1} className="dash-heading truncate outline-none">
              {name}
            </h2>
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block truncate text-[13px] text-[var(--fg-muted)] hover:text-[var(--fg)] hover:underline"
            >
              {host}
              <span className="sr-only"> (site audité, nouvel onglet)</span>
            </a>
          </div>
          {progress !== null && progress !== 'queued' ? (
            <Progress step={progress} />
          ) : (
            <StatusPill status={status} />
          )}
        </div>
        <PanelActions
          auditId={row.id}
          name={name}
          shareLink={shareLink}
          previewHref={preview}
          pdfHref={`/api/audits/full/${row.slug}/pdf`}
          completed={status === 'completed'}
          running={status === 'running'}
          smtpReady={smtpReady}
          defaultSubject={fillEmailTemplate(smtp?.subject_template ?? DEFAULT_EMAIL_SUBJECT, vars)}
          defaultBody={fillEmailTemplate(smtp?.body_template ?? DEFAULT_EMAIL_BODY, vars)}
        />
      </header>

      {score !== null ? (
        <section
          aria-label="Score"
          className="grid grid-cols-[minmax(0,140px)_1fr] items-center gap-4 px-5 py-6"
        >
          <ScoreFigure value={score} delta={delta} />
          <div className="flex justify-end">
            <AxisRadar axes={radar} size={232} />
          </div>
        </section>
      ) : null}

      {historyPoints.length > 0 ? (
        <Section
          title="Historique du score"
          aside={
            <span className="text-[12px] text-[var(--fg-muted)]">
              {historyPoints.length} scan{historyPoints.length > 1 ? 's' : ''}
            </span>
          }
        >
          <div className="flex items-center gap-4">
            <ScoreSparkline points={historyPoints} />
            <dl className="text-[12px] text-[var(--fg-muted)]">
              <div>
                <dt className="sr-only">Premier scan</dt>
                <dd>
                  Premier :{' '}
                  <span className="font-medium text-[var(--fg)]">{historyPoints[0]?.value}</span>
                  /100
                </dd>
              </div>
              <div>
                <dt className="sr-only">Dernier scan</dt>
                <dd>
                  Dernier :{' '}
                  <span className="font-medium text-[var(--fg)]">
                    {historyPoints[historyPoints.length - 1]?.value}
                  </span>
                  /100
                </dd>
              </div>
            </dl>
          </div>
        </Section>
      ) : null}

      {top.length > 0 ? (
        <Section title="Problèmes prioritaires">
          <ul className="-mx-2">
            {top.map((f) => (
              <li key={f.id}>
                <a
                  href={`${preview}#pb-${f.id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 60)}`}
                  target="_blank"
                  rel="noopener"
                  className="group grid grid-cols-[72px_1fr] gap-x-3 rounded-md px-2 py-1.5 text-[13px] hover:bg-[var(--bg-hover)]"
                >
                  <span
                    className={
                      f.severity === 'P0'
                        ? 'font-medium text-[var(--danger)]'
                        : 'text-[var(--fg-muted)]'
                    }
                  >
                    {SEVERITY_LABEL[f.severity] ?? f.severity}
                  </span>
                  <span className="min-w-0">
                    <span className="block group-hover:underline">{f.title}</span>
                    <span className="block text-[12px] text-[var(--fg-muted)]">
                      {f.axis in AXIS_LONG ? AXIS_LONG[f.axis as AuditAxis] : f.axis}
                    </span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {extra ? (
            <p className="mt-3 text-[12px] text-[var(--fg-muted)]">
              {extra.severity_counts.P0} critique(s), {extra.severity_counts.P1} important(s),{' '}
              {extra.severity_counts.P2 + extra.severity_counts.P3} autres.
            </p>
          ) : null}
        </Section>
      ) : null}

      <Section
        title="Ouvertures du lien"
        aside={
          row.views_count > 0 ? (
            <span className="text-[12px] text-[var(--fg-muted)]">{row.views_count} au total</span>
          ) : null
        }
      >
        {row.tracking_token === null ? (
          <p className="text-[13px] text-[var(--fg-muted)]">Pas de lien de suivi pour cet audit.</p>
        ) : opens.rows.length === 0 ? (
          <p className="text-[13px] text-[var(--fg-muted)]">
            Pas encore ouvert. Tu sauras quand le prospect lira le rapport.
          </p>
        ) : (
          <>
            <p className="mb-1.5 text-[12px] text-[var(--fg-muted)]">
              Première ouverture : {opens.first ? dateTime(opens.first) : '-'}
            </p>
            <ul className="space-y-1">
              {opens.rows.map((o, i) => (
                <li
                  key={`${o.viewed_at}-${String(i)}`}
                  className="flex items-center justify-between gap-2 text-[13px]"
                >
                  <span className="tabular-nums">{dateTime(o.viewed_at)}</span>
                  <span className="text-[var(--fg-muted)]">
                    {o.user_agent ?? 'Navigateur inconnu'}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      <Section title="Envois">
        {sends.length === 0 ? (
          <p className="text-[13px] text-[var(--fg-muted)]">
            {smtpReady ? (
              'Aucun envoi pour le moment.'
            ) : (
              <>
                Configure ton SMTP dans{' '}
                <Link href="/dashboard/reglages/email" className="dash-link">
                  Réglages, Email
                </Link>{' '}
                pour envoyer le rapport d’ici.
              </>
            )}
          </p>
        ) : (
          <ul className="space-y-1">
            {sends.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="min-w-0 truncate">{s.recipient}</span>
                <span className="flex shrink-0 items-center gap-2 text-[12px] text-[var(--fg-muted)]">
                  <span className="tabular-nums">{dateTime(s.created_at)}</span>
                  <span className={s.status === 'sent' ? '' : 'font-medium text-[var(--danger)]'}>
                    {s.status === 'sent' ? 'Envoyé' : 'Échec'}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Détails">
        <dl className="grid grid-cols-[112px_1fr] gap-x-3 gap-y-2 text-[13px]">
          <dt className="text-[var(--fg-muted)]">Modèle</dt>
          <dd>
            <TemplatePicker
              auditId={row.id}
              value={row.template_id ?? ''}
              options={enabledTemplates.map((t) => ({ id: t.id, name: t.name }))}
              defaultName={defaultTemplate?.name ?? 'Minimaliste'}
            />
          </dd>
          <dt className="text-[var(--fg-muted)]">Modules</dt>
          <dd>
            {modules === null
              ? '8 axes'
              : [
                  `${String(modules.axes.length)} axe${modules.axes.length > 1 ? 's' : ''}`,
                  modules.ai_readiness ? 'préparation IA' : null,
                  modules.vision ? 'vision' : null,
                  modules.lighthouse ? 'Lighthouse' : null,
                ]
                  .filter(Boolean)
                  .join(', ')}
          </dd>
          <dt className="text-[var(--fg-muted)]">Source</dt>
          <dd>{SOURCE_LABEL[row.source] ?? row.source}</dd>
          {extra && extra.external_refs.length > 0 ? (
            <>
              <dt className="text-[var(--fg-muted)]">Référence</dt>
              <dd className="break-all">{extra.external_refs.join(', ')}</dd>
            </>
          ) : null}
          <dt className="text-[var(--fg-muted)]">Créé le</dt>
          <dd>{longDate(row.created_at)}</dd>
          <dt className="text-[var(--fg-muted)]">Expire le</dt>
          <dd>{longDate(row.expires_at)}</dd>
          {row.pages !== null ? (
            <>
              <dt className="text-[var(--fg-muted)]">Pages</dt>
              <dd>
                {row.pages} analysée{row.pages > 1 ? 's' : ''}
              </dd>
            </>
          ) : null}
        </dl>
      </Section>
    </div>
  );
}
