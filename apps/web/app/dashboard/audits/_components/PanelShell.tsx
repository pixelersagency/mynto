'use client';

import { ChevronDown, ChevronUp, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

/**
 * Side panel of an audit record: slides in from the right, Échap closes it,
 * ↑ / ↓ (or k / j) move to the previous / next audit of the list. The URL
 * (/dashboard/audits/<id>) is shareable.
 */
export function PanelShell({
  closeHref,
  prevHref,
  nextHref,
  children,
}: {
  closeHref: string;
  prevHref: string | null;
  nextHref: string | null;
  children: React.ReactNode;
}): React.ReactElement {
  const router = useRouter();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    // Move focus into the panel so keyboard and screen reader users land on it.
    const title = ref.current?.querySelector<HTMLElement>('#panel-title');
    title?.focus({ preventScroll: true });
  }, [children]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        router.push(closeHref as '/dashboard', { scroll: false });
      } else if ((e.key === 'ArrowDown' || e.key === 'j') && nextHref) {
        e.preventDefault();
        router.push(nextHref as '/dashboard', { scroll: false });
      } else if ((e.key === 'ArrowUp' || e.key === 'k') && prevHref) {
        e.preventDefault();
        router.push(prevHref as '/dashboard', { scroll: false });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [router, closeHref, prevHref, nextHref]);

  const navBtn =
    'inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)] aria-disabled:pointer-events-none aria-disabled:opacity-40';
  return (
    <aside
      ref={ref}
      aria-labelledby="panel-title"
      className="dash-panel fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-[var(--border)] bg-[var(--bg)] shadow-[var(--shadow-panel)] sm:w-[460px]"
    >
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-[var(--border)] px-3">
        <span className="text-[12px] text-[var(--fg-muted)]">Fiche audit</span>
        <span className="ml-auto flex items-center gap-0.5">
          <Link
            href={(prevHref ?? closeHref) as '/dashboard'}
            scroll={false}
            aria-disabled={prevHref === null}
            tabIndex={prevHref === null ? -1 : undefined}
            className={navBtn}
            aria-label="Audit précédent (flèche haut)"
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href={(nextHref ?? closeHref) as '/dashboard'}
            scroll={false}
            aria-disabled={nextHref === null}
            tabIndex={nextHref === null ? -1 : undefined}
            className={navBtn}
            aria-label="Audit suivant (flèche bas)"
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href={closeHref as '/dashboard'}
            scroll={false}
            className={navBtn}
            aria-label="Fermer la fiche (Échap)"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Link>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
}
