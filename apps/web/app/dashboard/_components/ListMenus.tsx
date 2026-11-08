'use client';

import { ArrowUpDown, ChevronLeft, ChevronRight, ListFilter } from 'lucide-react';
import Link from 'next/link';

import { DashButton } from '@/components/ui/dash-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  currentMonth,
  listQuery,
  shiftMonth,
  type ListParams,
  type SortParam,
  type StatusParam,
} from '@/lib/dashboard/params';
import { cn } from '@/lib/utils';

const SORT_LABEL: Record<SortParam, string> = {
  recent: 'Plus récents',
  ancien: 'Plus anciens',
  'score-haut': 'Meilleur score',
  'score-bas': 'Score le plus bas',
};

function href(p: Partial<ListParams>): '/dashboard' {
  return `/dashboard/audits${listQuery(p)}` as '/dashboard';
}

function Check({ on }: { on: boolean }): React.ReactElement {
  return (
    <span className="flex w-4 justify-center" aria-hidden="true">
      {on ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" /> : null}
    </span>
  );
}

export function SortMenu({ params }: { params: ListParams }): React.ReactElement {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <DashButton variant="secondary" size="md" aria-label={`Trier : ${SORT_LABEL[params.tri]}`}>
          <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="max-md:hidden">Trier</span>
        </DashButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Trier par</DropdownMenuLabel>
        {(Object.keys(SORT_LABEL) as SortParam[]).map((s) => (
          <DropdownMenuItem key={s} asChild>
            <Link href={href({ ...params, tri: s, page: 1 })} aria-current={params.tri === s}>
              <Check on={params.tri === s} />
              {SORT_LABEL[s]}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const STATUS_LABEL: Record<StatusParam, string> = {
  'en-cours': 'En cours',
  termine: 'Terminé',
  echec: 'Échec',
  expire: 'Expiré',
};

function monthLabel(month: string): string {
  const [y, m] = month.split('-');
  return new Intl.DateTimeFormat('fr-FR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(Number(y), Number(m) - 1, 1)));
}

export function FilterMenu({ params }: { params: ListParams }): React.ReactElement {
  const active = (params.statut ? 1 : 0) + (params.mois ? 1 : 0) + (params.ia ? 1 : 0);
  const month = params.mois ?? currentMonth();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <DashButton
          variant="secondary"
          size="md"
          aria-label={active > 0 ? `Filtrer, ${String(active)} filtre(s) actif(s)` : 'Filtrer'}
        >
          <ListFilter className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="max-md:hidden">Filtrer</span>
          {active > 0 ? (
            <span className="tabular-nums text-[var(--fg-muted)]">{active}</span>
          ) : null}
        </DashButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel>Statut</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href={href({ ...params, statut: null, page: 1 })}>
            <Check on={params.statut === null} />
            Tous les statuts
          </Link>
        </DropdownMenuItem>
        {(Object.keys(STATUS_LABEL) as StatusParam[]).map((s) => (
          <DropdownMenuItem key={s} asChild>
            <Link href={href({ ...params, statut: s, page: 1 })}>
              <Check on={params.statut === s} />
              {STATUS_LABEL[s]}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Préparation IA</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href={href({ ...params, ia: null, page: 1 })}>
            <Check on={params.ia === null} />
            Tous les scores IA
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={href({ ...params, ia: 'faible', page: 1 })}>
            <Check on={params.ia === 'faible'} />
            Préparation IA faible
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Mois de création</DropdownMenuLabel>
        <div className="flex items-center gap-1 px-1 pb-1">
          <DropdownMenuItem asChild className="w-8 justify-center px-0">
            <Link
              href={href({ ...params, mois: shiftMonth(month, -1), page: 1 })}
              aria-label="Mois précédent"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Link>
          </DropdownMenuItem>
          <span
            className={cn(
              'flex-1 text-center text-[13px] capitalize',
              params.mois ? 'font-medium' : 'text-[var(--fg-muted)]',
            )}
          >
            {monthLabel(month)}
          </span>
          <DropdownMenuItem asChild className="w-8 justify-center px-0">
            <Link
              href={href({ ...params, mois: shiftMonth(month, 1), page: 1 })}
              aria-label="Mois suivant"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </DropdownMenuItem>
        </div>
        {params.mois ? (
          <DropdownMenuItem asChild>
            <Link href={href({ ...params, mois: null, page: 1 })}>
              <Check on={false} />
              Tous les mois
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem asChild>
            <Link href={href({ ...params, mois: month, page: 1 })}>
              <Check on={false} />
              Seulement {monthLabel(month)}
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
