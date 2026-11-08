'use client';

import { Loader2, Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { quickAuditAction } from '../audits/actions';

import { DashButton } from '@/components/ui/dash-button';

/** Paste a URL, launch an audit with the install defaults, land on its record. */
export function QuickLaunch({ autoFocus = false }: { autoFocus?: boolean }): React.ReactElement {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex w-full flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        const url = new FormData(e.currentTarget).get('url');
        start(async () => {
          const res = await quickAuditAction({ url });
          if (res.ok && res.id) router.push(`/dashboard/audits/${res.id}` as '/dashboard');
          else setError(res.message);
        });
      }}
    >
      <div className="flex gap-2">
        <label htmlFor="quick-url" className="sr-only">
          Adresse du site à auditer
        </label>
        <input
          id="quick-url"
          name="url"
          required
          autoFocus={autoFocus}
          inputMode="url"
          placeholder="exemple.fr"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'quick-url-error' : undefined}
          className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 text-[14px] placeholder:text-[var(--fg-muted)] focus-visible:border-[var(--accent)]"
        />
        <DashButton type="submit" variant="primary" size="lg" className="h-9" disabled={pending}>
          {pending ? (
            <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Lancer l’audit
        </DashButton>
      </div>
      {error ? (
        <p id="quick-url-error" role="alert" className="text-[12px] text-[var(--danger)]">
          {error}
        </p>
      ) : null}
    </form>
  );
}
