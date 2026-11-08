import type { ActivityEvent } from '@mynto/db';
import type { Metadata } from 'next';
import Link from 'next/link';

import { Topbar } from '../_components/Topbar';

import { EmptyState } from '@/components/ui/empty-state';
import { SOURCE_LABEL, hostOf, siteName } from '@/lib/dashboard/format';
import { db, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';

export const metadata: Metadata = { title: 'Activité' };

const KIND_LABEL: Record<ActivityEvent['kind'], string> = {
  created: 'Audit lancé',
  completed: 'Audit terminé',
  failed: 'Audit en échec',
  opened: 'Lien ouvert',
};

function when(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  }).format(new Date(iso));
}

/** Chronological feed: audits launched, finished, failed, links opened. */
export default async function ActivityPage(): Promise<React.ReactElement> {
  let events: ActivityEvent[] = [];
  let failed = false;
  try {
    events = await db().analytics.activity(80);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'activity_read_failed');
    failed = true;
  }
  return (
    <>
      <Topbar crumbs={[{ label: 'Activité' }]} />
      <main id="main" className="flex flex-1 flex-col px-4 py-6 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
          <h1 className="dash-display">Activité</h1>
          <p className="mt-1 text-[13px] text-[var(--fg-muted)]">
            Les derniers événements, du plus récent au plus ancien.
          </p>
          {failed ? (
            <p role="alert" className="dash-note dash-note--danger mt-4">
              Impossible de charger l’activité.
            </p>
          ) : events.length === 0 ? (
            <EmptyState
              title="Rien pour le moment."
              description="Les audits lancés, terminés ou en échec et les rapports ouverts apparaissent ici."
            />
          ) : (
            <ol className="mt-6 border-t border-[var(--border)]">
              {events.map((e, i) => (
                <li
                  key={`${e.kind}-${e.audit_id}-${e.at}-${String(i)}`}
                  className="grid grid-cols-[132px_1fr] items-baseline gap-4 border-b border-[var(--border)] py-2.5 text-[13px] max-sm:grid-cols-1 max-sm:gap-0.5"
                >
                  <time
                    dateTime={e.at}
                    className="whitespace-nowrap text-[12px] tabular-nums text-[var(--fg-muted)]"
                  >
                    {when(e.at)}
                  </time>
                  <span className="min-w-0">
                    <span
                      className={
                        e.kind === 'failed' ? 'font-medium text-[var(--danger)]' : 'font-medium'
                      }
                    >
                      {KIND_LABEL[e.kind]}
                    </span>{' '}
                    <Link
                      href={`/dashboard/audits/${e.audit_id}` as '/dashboard'}
                      className="hover:underline"
                    >
                      {siteName(e.url, e.label)}
                    </Link>
                    <span className="text-[var(--fg-muted)]">
                      {' '}
                      {hostOf(e.url)}, {SOURCE_LABEL[e.source] ?? e.source}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </main>
    </>
  );
}
