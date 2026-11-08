import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import { NavButton } from './DashShell';

import { scannerOnline } from '@/lib/scanner/client';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  href?: string;
}

/** Top bar: breadcrumb, scanner status chip, page actions. */
export function Topbar({
  crumbs,
  children,
}: {
  crumbs: Crumb[];
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <header className="sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--bg)] px-3 sm:px-4">
      <NavButton />
      <nav aria-label="Fil d’Ariane" className="min-w-0">
        <ol className="flex min-w-0 items-center gap-1.5 text-[13px]">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={`${c.label}-${String(i)}`} className="flex min-w-0 items-center gap-1.5">
                {i > 0 ? (
                  <ChevronRight
                    className="h-3.5 w-3.5 shrink-0 text-[var(--fg-muted)]"
                    aria-hidden="true"
                  />
                ) : null}
                {c.href && !last ? (
                  <Link
                    href={c.href as '/dashboard'}
                    className="flex items-center gap-1.5 text-[var(--fg-muted)] hover:text-[var(--fg)]"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span
                    className={cn(
                      'flex min-w-0 items-center gap-1.5 truncate',
                      last ? 'font-medium text-[var(--fg)]' : 'text-[var(--fg-muted)]',
                    )}
                    aria-current={last ? 'page' : undefined}
                  >
                    <span className="truncate">{c.label}</span>
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <Suspense fallback={<StatusChipView online={null} />}>
          <StatusChip />
        </Suspense>
        {children}
      </div>
    </header>
  );
}

async function StatusChip(): Promise<React.ReactElement> {
  return <StatusChipView online={await scannerOnline()} />;
}

function StatusChipView({ online }: { online: boolean | null }): React.ReactElement {
  const label =
    online === null
      ? 'Vérification du scanner'
      : online
        ? 'Scanner en ligne'
        : 'Scanner hors ligne';
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center gap-1.5 px-1 text-[12px]',
        online === false ? 'font-medium text-[var(--danger)]' : 'text-[var(--fg-muted)]',
      )}
      title={
        online === false
          ? 'Le scanner ne répond pas : les audits ne peuvent pas être lancés.'
          : 'État du scanner et de la file d’audit'
      }
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          online === true && 'bg-[var(--success)]',
          online === false && 'bg-[var(--danger)]',
          online === null && 'bg-[var(--fg-muted)]',
        )}
      />
      {label}
    </span>
  );
}
