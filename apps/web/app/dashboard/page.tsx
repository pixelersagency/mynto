import type { ActivityEvent, HomeItem, WeekStats } from '@mynto/db';
import type { ApiWebhook } from '@mynto/shared';
import { Check, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { SiteIcon } from './_components/AuditsTable';
import { Topbar } from './_components/Topbar';
import { Trend } from './_components/viz';
import { BrandStep } from './_home/BrandStep';
import { QuickLaunch } from './_home/QuickLaunch';

import { DashButton } from '@/components/ui/dash-button';
import { getBranding } from '@/lib/branding';
import { siteName } from '@/lib/dashboard/format';
import { db, pgErrorCode } from '@/lib/db';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { hostOf, score100 } from '@/lib/scores';
import { autoDisabledWebhooks } from '@/lib/services/webhooks';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Accueil' };

function relative(iso: string, now = Date.now()): string {
  const diff = Math.round((Date.parse(iso) - now) / 60_000);
  const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(diff, 'minute');
  if (abs < 60 * 24) return rtf.format(Math.round(diff / 60), 'hour');
  return rtf.format(Math.round(diff / (60 * 24)), 'day');
}

const ACTIVITY_LABEL: Record<ActivityEvent['kind'], string> = {
  created: 'Audit lancé',
  completed: 'Audit terminé',
  failed: 'Audit en échec',
  opened: 'Rapport ouvert',
};

interface HomeData {
  todo: { opened: HomeItem[]; failed: HomeItem[]; expiring: HomeItem[] };
  week: WeekStats;
  activity: ActivityEvent[];
  total: number;
  hasAiKey: boolean;
  /** Webhooks switched off after 20 final failures in a row. */
  webhooks: ApiWebhook[];
}

async function load(): Promise<HomeData | null> {
  try {
    const [todo, week, activity, counts, keys, webhooks] = await Promise.all([
      db().dashboard.todo(5),
      db().dashboard.weekStats(),
      db().analytics.activity(8),
      db().dashboard.counts(new Date().toISOString()),
      db().ai.listKeys(),
      autoDisabledWebhooks(),
    ]);
    const env = getServerEnv();
    const hasAiKey =
      keys.length > 0 ||
      Boolean(env.ANTHROPIC_API_KEY ?? env.GEMINI_API_KEY ?? env.MISTRAL_API_KEY);
    return { todo, week, activity, total: counts.all, hasAiKey, webhooks };
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'home_load_failed');
    return null;
  }
}

export default async function HomePage(): Promise<React.ReactElement> {
  const [data, brand] = await Promise.all([load(), getBranding()]);
  const firstRun = data !== null && data.total === 0;
  const todoCount = data
    ? data.todo.opened.length +
      data.todo.failed.length +
      data.todo.expiring.length +
      data.webhooks.length
    : 0;
  const today = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Paris',
  }).format(new Date());

  return (
    <>
      <Topbar crumbs={[{ label: 'Accueil' }]}>
        <DashButton asChild variant="primary" size="md">
          <Link href="/dashboard/nouveau">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nouvel audit
          </Link>
        </DashButton>
      </Topbar>
      <main id="main" className="flex-1 px-4 py-8 sm:px-8">
        <div className="mx-auto max-w-[1080px]">
          <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[13px] text-[var(--fg-muted)]">
                {today.charAt(0).toUpperCase() + today.slice(1)}
              </p>
              <h1 className="mt-2 dash-display">
                {firstRun
                  ? `Bienvenue, ${brand.name}`
                  : todoCount > 0
                    ? todoCount === 1
                      ? '1 chose à faire'
                      : `${String(todoCount)} choses à faire`
                    : 'Tout est à jour'}
              </h1>
            </div>
            {!firstRun ? (
              <div className="w-full md:max-w-[420px]">
                <QuickLaunch />
              </div>
            ) : null}
          </div>

          {data === null ? (
            <p role="alert" className="dash-note dash-note--danger mt-8">
              Impossible de charger l’accueil. Vérifie la connexion à la base de données.
            </p>
          ) : firstRun ? (
            <Wizard
              brandDone={brand.source === 'settings'}
              name={brand.name}
              color={brand.primaryColor}
              hasAiKey={data.hasAiKey}
            />
          ) : (
            <>
              <WeekTiles week={data.week} />
              <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_320px]">
                <section aria-labelledby="todo-title">
                  <h2 id="todo-title" className="dash-heading">
                    À faire
                  </h2>
                  {todoCount === 0 ? (
                    <div className="mt-3 border-t border-[var(--border)] pt-4">
                      <p className="text-[14px] font-medium">Rien à relancer pour le moment.</p>
                      <p className="mt-1 max-w-md text-[13px] text-[var(--fg-muted)]">
                        Les rapports ouverts par tes prospects, les audits en échec et ceux qui
                        expirent apparaîtront ici.
                      </p>
                    </div>
                  ) : (
                    <div className="mt-3 space-y-8">
                      <WebhookAlerts items={data.webhooks} />
                      <TodoGroup
                        title="Ouverts, à relancer"
                        items={data.todo.opened}
                        meta={(i) =>
                          `Ouvert ${relative(i.last_viewed_at ?? i.created_at)}${i.views_count > 1 ? `, ${String(i.views_count)} fois` : ''}`
                        }
                      />
                      <TodoGroup
                        title="En échec"
                        items={data.todo.failed}
                        meta={(i) => `Lancé ${relative(i.created_at)}. Relance-le depuis sa fiche.`}
                      />
                      <TodoGroup
                        title="Expirent bientôt"
                        items={data.todo.expiring}
                        meta={(i) => `Expire ${relative(i.expires_at)}`}
                      />
                    </div>
                  )}
                </section>
                <section aria-labelledby="activity-title">
                  <div className="flex items-baseline justify-between">
                    <h2 id="activity-title" className="dash-heading">
                      Activité récente
                    </h2>
                    <Link href="/dashboard/activite" className="text-[13px] dash-link">
                      Tout voir
                    </Link>
                  </div>
                  <ol className="mt-3 border-t border-[var(--border)] pt-1">
                    {data.activity.map((e, i) => (
                      <li key={`${e.audit_id}-${e.kind}-${String(i)}`}>
                        <Link
                          href={`/dashboard/audits/${e.audit_id}` as '/dashboard'}
                          className="-mx-2 flex items-baseline gap-3 rounded-md px-2 py-1.5 hover:bg-[var(--bg-hover)]"
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px]">
                            <span
                              className={
                                e.kind === 'failed'
                                  ? 'font-medium text-[var(--danger)]'
                                  : 'font-medium'
                              }
                            >
                              {ACTIVITY_LABEL[e.kind]}
                            </span>{' '}
                            <span className="text-[var(--fg-muted)]">
                              {siteName(e.url, e.label)}
                            </span>
                          </span>
                          <span className="shrink-0 text-[12px] tabular-nums text-[var(--fg-muted)]">
                            {relative(e.at)}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}

function WeekTiles({ week }: { week: WeekStats }): React.ReactElement {
  const avg = week.avg_score === null ? null : score100(week.avg_score);
  const avgPrev = week.avg_score_prev === null ? null : score100(week.avg_score_prev);
  const tiles = [
    {
      label: 'Audits lancés',
      value: String(week.audits),
      trend: <Trend current={week.audits} previous={week.audits_prev} />,
    },
    {
      label: 'Ouvertures de rapports',
      value: String(week.opens),
      trend: <Trend current={week.opens} previous={week.opens_prev} />,
    },
    {
      label: 'Score moyen',
      value: avg === null ? '-' : `${String(avg)}/100`,
      trend:
        avg !== null && avgPrev !== null ? (
          <Trend current={avg} previous={avgPrev} unit=" pts" />
        ) : (
          <span className="text-[12px] text-[var(--fg-muted)]">Pas de comparaison</span>
        ),
    },
    {
      label: 'Rapports envoyés',
      value: String(week.emails),
      trend: <Trend current={week.emails} previous={week.emails_prev} />,
    },
  ];
  return (
    <section aria-labelledby="week-title" className="mt-8">
      <h2 id="week-title" className="sr-only">
        Les 7 derniers jours
      </h2>
      <ul className="grid grid-cols-2 gap-x-8 gap-y-8 pt-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <li key={t.label} className="flex flex-col gap-1">
            <span className="text-[13px] text-[var(--fg-muted)]">{t.label}, 7 jours</span>
            <span className="dash-num text-[34px] leading-tight">{t.value}</span>
            {t.trend}
          </li>
        ))}
      </ul>
    </section>
  );
}

function TodoGroup({
  title,
  items,
  meta,
}: {
  title: string;
  items: HomeItem[];
  meta: (i: HomeItem) => string;
}): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="flex items-baseline gap-2 text-[13px] font-medium">
        {title}
        <span className="font-normal tabular-nums text-[var(--fg-muted)]">{items.length}</span>
      </h3>
      <ul className="mt-2 border-t border-[var(--border)]">
        {items.map((i) => {
          const score = score100(i.global_score);
          return (
            <li key={i.id} className="border-b border-[var(--border)]">
              <Link
                href={`/dashboard/audits/${i.id}` as '/dashboard'}
                className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-[var(--bg-hover)]"
              >
                <SiteIcon
                  seed={hostOf(i.url)}
                  faviconUrl={i.favicon_key ? `/media/${i.favicon_key}` : null}
                  size={20}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium">
                    {siteName(i.url, i.label)}
                  </span>
                  <span className="block truncate text-[12px] text-[var(--fg-muted)]">
                    {meta(i)}
                  </span>
                </span>
                {score !== null ? (
                  <span className="text-[13px] tabular-nums text-[var(--fg-muted)]">
                    {score}/100
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Wizard({
  brandDone,
  name,
  color,
  hasAiKey,
}: {
  brandDone: boolean;
  name: string;
  color: string;
  hasAiKey: boolean;
}): React.ReactElement {
  const steps = [brandDone, hasAiKey, false];
  const done = steps.filter(Boolean).length;
  return (
    <section aria-labelledby="wizard-title" className="mt-10 max-w-2xl">
      <h2 id="wizard-title" className="dash-heading">
        Trois étapes pour ton premier rapport
      </h2>
      <p className="mt-1 text-[13px] text-[var(--fg-muted)]">
        {done} sur 3 faites. Tout se modifie ensuite dans les réglages.
      </p>
      <ol className="mt-6 border-t border-[var(--border)]">
        <Step n={1} done={brandDone} title="Ta marque">
          <p className="text-[13px] text-[var(--fg-muted)]">
            Ton nom et ta couleur apparaissent sur chaque rapport et chaque PDF. Le logo se règle
            dans{' '}
            <Link href="/dashboard/reglages" className="dash-link">
              Réglages, Marque
            </Link>
            .
          </p>
          <BrandStep name={name} color={color} />
        </Step>
        <Step n={2} done={hasAiKey} title="Ta clé IA">
          <p className="text-[13px] text-[var(--fg-muted)]">
            Elle rédige la synthèse et les recommandations. Sans clé, le rapport reste complet mais
            plus sec. Claude est utilisé par défaut.
          </p>
          <DashButton asChild size="sm" className="mt-3">
            <Link href="/dashboard/reglages/ia">
              {hasAiKey ? 'Voir la configuration' : 'Ajouter une clé'}
            </Link>
          </DashButton>
        </Step>
        <Step n={3} done={false} title="Ton premier audit">
          <p className="mb-3 text-[13px] text-[var(--fg-muted)]">
            Colle l’adresse d’un site. Compte 2 à 5 minutes pour 8 axes et la préparation IA. Tu
            obtiens un rapport à ton nom et un lien de suivi qui te dit quand ton prospect l’ouvre.
          </p>
          <QuickLaunch />
        </Step>
      </ol>
    </section>
  );
}

function Step({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <li className="grid grid-cols-[28px_1fr] gap-x-3 border-b border-[var(--border)] py-5">
      <span
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-medium tabular-nums',
          done
            ? 'bg-[var(--fg)] text-[var(--bg)]'
            : 'border border-[var(--border-strong)] text-[var(--fg-muted)]',
        )}
      >
        {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : n}
      </span>
      <div>
        <h3 className="flex items-baseline justify-between gap-2 text-[14px] font-medium">
          {title}
          <span className="text-[12px] font-normal text-[var(--fg-muted)]">
            {done ? 'Fait' : 'À faire'}
          </span>
        </h3>
        <div className="mt-1.5">{children}</div>
      </div>
    </li>
  );
}

/** "À faire": webhooks switched off after 20 final failures in a row. */
function WebhookAlerts({ items }: { items: ApiWebhook[] }): React.ReactElement | null {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="flex items-baseline gap-2 text-[13px] font-medium text-[var(--danger)]">
        Webhooks désactivés
        <span className="font-normal tabular-nums text-[var(--fg-muted)]">{items.length}</span>
      </h3>
      <ul className="mt-2 border-t border-[var(--border)]">
        {items.map((w) => (
          <li key={w.id} className="border-b border-[var(--border)]">
            <Link
              href={`/dashboard/reglages/webhooks/${w.id}` as '/dashboard'}
              className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 hover:bg-[var(--bg-hover)]"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-mono text-[12px]">{w.url}</span>
                <span className="block truncate text-[12px] text-[var(--fg-muted)]">
                  20 échecs de suite. Vérifie la cible puis réactive-le.
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
