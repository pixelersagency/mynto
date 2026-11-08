'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Progress of an audit that is not finished yet. Polls the public status
 * and re-renders the page (server-side template) once it is completed.
 */

const POLL_INTERVAL_MS = 4_000;
const MAX_POLLS = 120;

const STEPS = [
  { key: 'queued', label: 'En file d’attente' },
  { key: 'loading', label: 'Chargement du site' },
  { key: 'analysis', label: 'Analyse des 8 axes' },
  { key: 'writing', label: 'Rédaction du rapport' },
] as const;

function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60))}:${String(total % 60).padStart(2, '0')}`;
}

export function FullAuditPoller({
  slug,
  createdAt,
  initialStatus,
}: {
  slug: string;
  createdAt: string;
  initialStatus: string;
}): React.ReactElement {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [polls, setPolls] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const started = useRef(new Date(createdAt).getTime());

  useEffect(() => {
    const t = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);
    return () => {
      window.clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (status === 'completed') {
      router.refresh();
      return;
    }
    if (status === 'failed' || polls >= MAX_POLLS) return;
    const t = window.setTimeout(() => {
      void fetch(`/api/audits/full/${slug}`, { cache: 'no-store' })
        .then(async (r) => (r.ok ? ((await r.json()) as { status?: string }) : null))
        .then((body) => {
          if (body?.status) setStatus(body.status);
        })
        .catch(() => undefined)
        .finally(() => {
          setPolls((n) => n + 1);
        });
    }, POLL_INTERVAL_MS);
    return () => {
      window.clearTimeout(t);
    };
  }, [status, polls, slug, router]);

  const ms = now - started.current;
  const current = status === 'queued' ? 0 : ms < 40_000 ? 1 : ms < 150_000 ? 2 : 3;

  if (status === 'failed') {
    return (
      <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
        <h1 className="text-xl font-semibold">L’audit n’a pas pu aboutir</h1>
        <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
          Le site n’a pas répondu ou a bloqué l’analyse. Demande une nouvelle analyse à l’agence qui
          t’a envoyé ce lien.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--color-border)] bg-white p-6">
      <h1 className="text-xl font-semibold">Analyse en cours</h1>
      <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
        Compte 2 à 5 minutes. La page s’actualise toute seule.{' '}
        <span className="tabular-nums">({elapsed(ms)})</span>
      </p>
      <ol className="mt-5 space-y-2" aria-live="polite">
        {STEPS.map((s, i) => (
          <li key={s.key} className="flex items-center gap-3 text-sm">
            <span
              aria-hidden="true"
              className={
                i < current
                  ? 'h-2.5 w-2.5 rounded-full bg-emerald-600'
                  : i === current
                    ? 'h-2.5 w-2.5 rounded-full bg-blue-600 motion-safe:animate-pulse'
                    : 'h-2.5 w-2.5 rounded-full border border-slate-300'
              }
            />
            <span
              className={i === current ? 'font-medium' : 'text-[var(--color-muted-foreground)]'}
            >
              {s.label}
              <span className="sr-only">
                {i < current ? ' : terminé' : i === current ? ' : en cours' : ' : à venir'}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
