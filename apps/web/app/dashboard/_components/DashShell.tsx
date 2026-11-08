'use client';

import {
  Activity,
  Command,
  Home,
  BarChart3,
  ChevronDown,
  Link2,
  LayoutList,
  LogOut,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeft,
  Search,
  Settings,
  Sun,
  UserRound,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

import { logoutAction } from '../actions';

import { CommandPalette } from './CommandPalette';
import { Shortcuts } from './Shortcuts';
import { THEME_KEY } from './theme';

import { AgencyMark } from '@/components/agency-mark';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export interface ShellCounts {
  all: number;
  in_progress: number;
  failed: number;
  radar: number;
  this_month: number;
  links: number;
}

interface ShellProps {
  agencyName: string;
  logoUrl: string | null;
  adminEmail: string;
  counts: ShellCounts | null;
  children: React.ReactNode;
}

interface ShellContextValue {
  openNav: () => void;
  sidebarHidden: boolean;
}

const ShellContext = createContext<ShellContextValue>({
  openNav: () => undefined,
  sidebarHidden: false,
});

const SIDEBAR_KEY = 'mynto-sidebar-hidden';
type Theme = 'system' | 'light' | 'dark';

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the choice simply does not persist.
  }
}

/** Hamburger shown in the top bar under 1024 px, or when the sidebar is hidden. */
export function NavButton(): React.ReactElement {
  const { openNav, sidebarHidden } = useContext(ShellContext);
  return (
    <button
      type="button"
      onClick={openNav}
      className={cn(
        'mr-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]',
        sidebarHidden ? '' : 'lg:hidden',
      )}
      aria-label="Ouvrir la navigation"
    >
      <PanelLeft className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

export function DashShell({
  agencyName,
  logoUrl,
  adminEmail,
  counts,
  children,
}: ShellProps): React.ReactElement {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const [isDesktop, setIsDesktop] = useState(true);
  const pathname = usePathname();

  useEffect(() => {
    setSidebarHidden(readStorage(SIDEBAR_KEY) === '1');
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = (): void => {
      setIsDesktop(mq.matches);
    };
    sync();
    mq.addEventListener('change', sync);
    return () => {
      mq.removeEventListener('change', sync);
    };
  }, []);
  // Close the drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const openNav = useCallback(() => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setSidebarHidden(false);
      writeStorage(SIDEBAR_KEY, '0');
    } else {
      setDrawerOpen(true);
    }
  }, []);

  const hideSidebar = (): void => {
    if (window.matchMedia('(min-width: 1024px)').matches) {
      setSidebarHidden(true);
      writeStorage(SIDEBAR_KEY, '1');
    } else {
      setDrawerOpen(false);
    }
  };

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [drawerOpen]);

  return (
    <ShellContext.Provider value={{ openNav, sidebarHidden }}>
      <div className="flex min-h-screen">
        {/* Drawer backdrop (< 1024 px) */}
        {drawerOpen ? (
          <div
            className="fixed inset-0 z-40 bg-[var(--scrim)] lg:hidden"
            aria-hidden="true"
            onClick={() => {
              setDrawerOpen(false);
            }}
          />
        ) : null}
        <aside
          aria-label="Navigation principale"
          className={cn(
            'dash-paper fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-[var(--border)] bg-[var(--bg)] transition-transform duration-150',
            drawerOpen ? 'translate-x-0' : '-translate-x-full',
            sidebarHidden
              ? 'lg:-translate-x-full'
              : 'lg:sticky lg:top-0 lg:h-screen lg:translate-x-0',
          )}
          // Off-screen sidebar must not be reachable with Tab.
          inert={isDesktop ? sidebarHidden : !drawerOpen}
        >
          <Sidebar
            agencyName={agencyName}
            logoUrl={logoUrl}
            adminEmail={adminEmail}
            counts={counts}
            onHide={hideSidebar}
          />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>
      <CommandPalette />
      <Shortcuts />
    </ShellContext.Provider>
  );
}

function Sidebar({
  agencyName,
  logoUrl,
  adminEmail,
  counts,
  onHide,
}: Omit<ShellProps, 'children'> & { onHide: () => void }): React.ReactElement {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const onAudits = pathname.startsWith('/dashboard/audits');
  const vue = onAudits ? (params.get('vue') ?? 'tous') : null;
  const searchRef = useRef<HTMLInputElement>(null);
  const [viewsOpen, setViewsOpen] = useState(true);

  // "/" focuses the search, like Linear / GitHub.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const onSearch = (e: React.SyntheticEvent<HTMLFormElement>): void => {
    e.preventDefault();
    const q = new FormData(e.currentTarget).get('q');
    const value = typeof q === 'string' ? q.trim() : '';
    router.push(
      (value
        ? `/dashboard/audits?q=${encodeURIComponent(value)}`
        : '/dashboard/audits') as '/dashboard',
    );
  };

  return (
    <>
      <div className="flex h-12 items-center gap-2 px-3">
        <Link
          href="/dashboard/reglages"
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--bg-hover)]"
          title="Réglages de la marque"
        >
          <AgencyMark name={agencyName} logoUrl={logoUrl} size={22} />
          <span className="truncate text-[14px] font-medium">{agencyName}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--fg-muted)]" aria-hidden="true" />
        </Link>
        <button
          type="button"
          onClick={onHide}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          aria-label="Masquer la navigation"
        >
          <PanelLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <form role="search" onSubmit={onSearch} className="px-3 pb-2">
        <label htmlFor="dash-search" className="sr-only">
          Rechercher un audit
        </label>
        <div className="dash-field flex h-8 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg-subtle)] px-2.5 motion-safe:transition-[border-color,box-shadow]">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--fg-muted)]" aria-hidden="true" />
          <input
            ref={searchRef}
            id="dash-search"
            name="q"
            type="search"
            placeholder="Rechercher"
            defaultValue={params.get('q') ?? ''}
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--fg-muted)]"
            aria-keyshortcuts="/"
          />
          <kbd className="rounded border border-[var(--border-strong)] px-1 font-sans text-[11px] text-[var(--fg-muted)]">
            /
          </kbd>
        </div>
      </form>
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={() => {
            window.dispatchEvent(new Event('mynto:palette'));
          }}
          className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-[13px] text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
          aria-keyshortcuts="Meta+K Control+K"
        >
          <Command className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="flex-1 text-left">Commandes</span>
          <kbd>⌘K</kbd>
        </button>
      </div>

      <nav aria-label="Navigation du tableau de bord" className="flex-1 overflow-y-auto px-3 pb-3">
        <ul className="space-y-0.5">
          <NavItem
            href="/dashboard"
            icon={<Home className="h-4 w-4" aria-hidden="true" />}
            label="Accueil"
            active={pathname === '/dashboard'}
            hint="G puis H"
          />
          <NavItem
            href="/dashboard/audits"
            icon={<LayoutList className="h-4 w-4" aria-hidden="true" />}
            label="Audits"
            count={counts?.all}
            active={onAudits && vue === 'tous'}
            hint="G puis A"
          />
          <NavItem
            href="/dashboard/liens"
            icon={<Link2 className="h-4 w-4" aria-hidden="true" />}
            label="Liens de suivi"
            count={counts?.links}
            active={pathname.startsWith('/dashboard/liens')}
          />
          <NavItem
            href="/dashboard/analytics"
            icon={<BarChart3 className="h-4 w-4" aria-hidden="true" />}
            label="Analytics"
            active={pathname.startsWith('/dashboard/analytics')}
          />
          <NavItem
            href="/dashboard/activite"
            icon={<Activity className="h-4 w-4" aria-hidden="true" />}
            label="Activité"
            active={pathname.startsWith('/dashboard/activite')}
          />
        </ul>

        <div className="mt-5">
          <button
            type="button"
            onClick={() => {
              setViewsOpen((v) => !v);
            }}
            aria-expanded={viewsOpen}
            aria-controls="nav-views"
            className="dash-label flex w-full items-center gap-1 rounded-md px-2 py-1 hover:text-[var(--fg)]"
          >
            <ChevronDown
              className={cn('h-3 w-3 transition-transform', viewsOpen ? '' : '-rotate-90')}
              aria-hidden="true"
            />
            Vues
          </button>
          {viewsOpen ? (
            <ul id="nav-views" className="mt-1 space-y-0.5">
              <NavItem
                href="/dashboard/audits?vue=en-cours"
                label="En cours"
                count={counts?.in_progress}
                active={vue === 'en-cours'}
              />
              <NavItem
                href="/dashboard/audits?vue=echecs"
                label="Échecs"
                count={counts?.failed}
                active={vue === 'echecs'}
                alert={(counts?.failed ?? 0) > 0}
              />
              <NavItem
                href="/dashboard/audits?vue=radar"
                label="Radar"
                count={counts?.radar}
                active={vue === 'radar'}
              />
              <NavItem
                href="/dashboard/audits?vue=mois"
                label="Ce mois-ci"
                count={counts?.this_month}
                active={vue === 'mois'}
              />
            </ul>
          ) : null}
        </div>
      </nav>

      <div className="border-t border-[var(--border)] px-3 py-2">
        <ul className="space-y-0.5">
          <li>
            <ThemeToggle />
          </li>
          <NavItem
            href="/dashboard/reglages"
            icon={<Settings className="h-4 w-4" aria-hidden="true" />}
            label="Réglages"
            active={pathname.startsWith('/dashboard/reglages')}
          />
          <NavItem
            href="/dashboard/profil"
            icon={<UserRound className="h-4 w-4" aria-hidden="true" />}
            label="Profil"
            active={pathname.startsWith('/dashboard/profil')}
          />
        </ul>
        <div className="mt-2 flex items-center gap-2 border-t border-[var(--border)] px-2 pt-2">
          <span
            aria-hidden="true"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--bg-subtle)] text-[11px] font-medium text-[var(--fg-muted)]"
          >
            {adminEmail.charAt(0).toUpperCase()}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px]">{adminEmail}</span>
            <span className="block text-[12px] text-[var(--fg-muted)]">Admin</span>
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--fg-muted)] hover:bg-[var(--bg-hover)]"
              aria-label="Menu du compte"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" side="top">
              <DropdownMenuItem asChild>
                <Link href="/dashboard/profil">
                  <UserRound className="h-4 w-4" aria-hidden="true" /> Profil
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  void logoutAction();
                }}
              >
                <LogOut className="h-4 w-4" aria-hidden="true" /> Se déconnecter
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </>
  );
}

function NavItem({
  href,
  icon = null,
  label,
  count,
  active,
  alert = false,
  hint,
}: {
  href: string;
  icon?: React.ReactNode;
  label: string;
  count?: number | undefined;
  active: boolean;
  alert?: boolean;
  /** Keyboard shortcut, announced in the title. */
  hint?: string;
}): React.ReactElement {
  return (
    <li>
      <Link
        // typedRoutes: query-string variants of known routes.
        href={href as '/dashboard'}
        aria-current={active ? 'page' : undefined}
        title={hint ? `${label} (${hint})` : undefined}
        className={cn(
          'flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] text-[var(--fg-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]',
          // Active item: a 2px ink bar, so the state does not rest on the faint fill alone (3:1).
          active &&
            'relative bg-[var(--bg-subtle)] font-medium text-[var(--fg)] before:absolute before:inset-y-1.5 before:left-0 before:w-[2px] before:rounded-full before:bg-[var(--fg)]',
          icon === null && 'pl-[34px]',
        )}
      >
        {icon !== null ? (
          <span className={cn(active ? 'text-[var(--fg)]' : '')}>{icon}</span>
        ) : null}
        <span className="flex-1 truncate">{label}</span>
        {count !== undefined ? (
          <span
            className={cn(
              'text-[12px] tabular-nums',
              alert ? 'font-medium text-[var(--danger)]' : 'text-[var(--fg-muted)]',
            )}
          >
            {count}
            {alert ? <span className="sr-only"> à vérifier</span> : null}
          </span>
        ) : null}
      </Link>
    </li>
  );
}

const THEME_LABEL: Record<Theme, string> = {
  system: 'Système',
  light: 'Clair',
  dark: 'Sombre',
};

function ThemeToggle(): React.ReactElement {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    const stored = readStorage(THEME_KEY);
    if (stored === 'light' || stored === 'dark') setTheme(stored);
    const onTheme = (e: Event): void => {
      const next = (e as CustomEvent<Theme>).detail;
      setTheme(next);
    };
    window.addEventListener('mynto:theme', onTheme);
    return () => {
      window.removeEventListener('mynto:theme', onTheme);
    };
  }, []);
  const cycle = (): void => {
    const next: Theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
    setTheme(next);
    writeStorage(THEME_KEY, next);
    document.documentElement.dataset.theme = next;
  };
  const Icon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  return (
    <button
      type="button"
      onClick={cycle}
      className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-[13px] text-[var(--fg-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--fg)]"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      <span className="flex-1 text-left">Apparence</span>
      <span className="text-[12px]">{THEME_LABEL[theme]}</span>
      <span className="sr-only">, cliquer pour changer</span>
    </button>
  );
}
