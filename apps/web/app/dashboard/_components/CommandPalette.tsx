'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import {
  ArrowRight,
  CornerDownLeft,
  Globe,
  Monitor,
  Moon,
  Play,
  Search,
  Settings,
  Sun,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';

import { quickAuditAction, searchAuditsAction, type SearchHit } from '../audits/actions';

import { SiteIcon } from './AuditsTable';
import { THEME_KEY } from './theme';

import { urlCandidate } from '@/lib/dashboard/format';
import { cn } from '@/lib/utils';

/**
 * Command palette (⌘K / Ctrl+K): launch an audit by pasting a URL, find a
 * site, jump to a page or a settings section, switch the theme. Combobox
 * pattern: the input keeps focus, ↑ ↓ move the active option, Entrée runs it.
 */

interface Item {
  id: string;
  group: 'Lancer' | 'Sites' | 'Aller à' | 'Réglages' | 'Thème';
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void;
  site?: SearchHit;
}

const PAGES: { label: string; href: string; keys?: string; group: 'Aller à' | 'Réglages' }[] = [
  { label: 'Accueil', href: '/dashboard', keys: 'G H', group: 'Aller à' },
  { label: 'Audits', href: '/dashboard/audits', keys: 'G A', group: 'Aller à' },
  { label: 'Nouvel audit', href: '/dashboard/nouveau', keys: 'N', group: 'Aller à' },
  { label: 'Audits en cours', href: '/dashboard/audits?vue=en-cours', group: 'Aller à' },
  { label: 'Audits en échec', href: '/dashboard/audits?vue=echecs', group: 'Aller à' },
  { label: 'Liens de suivi', href: '/dashboard/liens', group: 'Aller à' },
  { label: 'Analytics', href: '/dashboard/analytics', group: 'Aller à' },
  { label: 'Activité', href: '/dashboard/activite', group: 'Aller à' },
  { label: 'Marque', href: '/dashboard/reglages', keys: 'G S', group: 'Réglages' },
  { label: 'Modèles de rapport', href: '/dashboard/reglages/modeles', group: 'Réglages' },
  { label: 'Polices', href: '/dashboard/reglages/polices', group: 'Réglages' },
  { label: 'Email (SMTP)', href: '/dashboard/reglages/email', group: 'Réglages' },
  { label: 'Modules d’audit', href: '/dashboard/reglages/modules', group: 'Réglages' },
  { label: 'IA', href: '/dashboard/reglages/ia', group: 'Réglages' },
  { label: 'API et MCP', href: '/dashboard/reglages/api', group: 'Réglages' },
  { label: 'Webhooks', href: '/dashboard/reglages/webhooks', group: 'Réglages' },
  { label: 'Profil', href: '/dashboard/profil', group: 'Réglages' },
];

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function setTheme(theme: 'light' | 'dark' | 'system'): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // ignore
  }
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new CustomEvent('mynto:theme', { detail: theme }));
}

export function CommandPalette(): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = (): void => {
      setOpen(true);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mynto:palette', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mynto:palette', onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) {
      setQ('');
      setHits([]);
      setMessage(null);
    }
  }, [open]);

  // Debounced site search.
  useEffect(() => {
    const value = q.trim();
    if (!open || value.length < 2) {
      setHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      void searchAuditsAction(value).then(setHits);
    }, 160);
    return () => {
      window.clearTimeout(t);
    };
  }, [q, open]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href as '/dashboard');
    },
    [router],
  );

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    const host = urlCandidate(q);
    if (host) {
      out.push({
        id: 'launch',
        group: 'Lancer',
        label: `Lancer un audit de ${host}`,
        hint: 'Réglages par défaut',
        icon: <Play className="h-4 w-4" aria-hidden="true" />,
        run: () => {
          start(async () => {
            setMessage('Lancement…');
            const res = await quickAuditAction({ url: q.trim() });
            if (res.ok && res.id) go(`/dashboard/audits/${res.id}`);
            else setMessage(res.message);
          });
        },
      });
    }
    for (const h of hits) {
      out.push({
        id: `site-${h.id}`,
        group: 'Sites',
        label: h.name,
        hint: h.score !== null ? `${String(h.score)}/100` : h.host,
        icon: <Globe className="h-4 w-4" aria-hidden="true" />,
        site: h,
        run: () => {
          go(`/dashboard/audits/${h.id}`);
        },
      });
    }
    const nq = norm(q.trim());
    for (const p of PAGES) {
      if (nq && !norm(p.label).includes(nq)) continue;
      out.push({
        id: `page-${p.href}`,
        group: p.group,
        label: p.label,
        ...(p.keys ? { hint: p.keys } : {}),
        icon:
          p.group === 'Réglages' ? (
            <Settings className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          ),
        run: () => {
          go(p.href);
        },
      });
    }
    const themes = [
      { id: 'light', label: 'Thème clair', icon: <Sun className="h-4 w-4" aria-hidden="true" /> },
      { id: 'dark', label: 'Thème sombre', icon: <Moon className="h-4 w-4" aria-hidden="true" /> },
      {
        id: 'system',
        label: 'Thème du système',
        icon: <Monitor className="h-4 w-4" aria-hidden="true" />,
      },
    ] as const;
    for (const t of themes) {
      if (nq && !norm(t.label).includes(nq) && !'theme'.includes(nq)) continue;
      out.push({
        id: `theme-${t.id}`,
        group: 'Thème',
        label: t.label,
        icon: t.icon,
        run: () => {
          setTheme(t.id);
          setOpen(false);
        },
      });
    }
    return out;
  }, [q, hits, go]);

  useEffect(() => {
    setActive(0);
  }, [q, hits.length]);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${String(active)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[active]?.run();
    }
  };

  let lastGroup = '';
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <div className="dash" style={{ display: 'contents' }}>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[var(--scrim)]" />
          <DialogPrimitive.Content
            className="dash-palette fixed left-1/2 top-[12vh] z-50 w-[calc(100vw-32px)] max-w-[580px] -translate-x-1/2 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] shadow-[var(--shadow-pop)]"
            aria-describedby={undefined}
          >
            <DialogPrimitive.Title className="sr-only">Palette de commandes</DialogPrimitive.Title>
            <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4">
              <Search className="h-4 w-4 shrink-0 text-[var(--fg-muted)]" aria-hidden="true" />
              <input
                autoFocus
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                }}
                onKeyDown={onKeyDown}
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={items[active] ? `palette-${items[active].id}` : undefined}
                aria-label="Colle une URL, cherche un site ou une page"
                placeholder="Colle une URL, cherche un site ou une page"
                className="dash-bare h-12 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-[var(--fg-muted)]"
              />
              <kbd>Échap</kbd>
            </div>
            <ul
              id="palette-list"
              ref={listRef}
              role="listbox"
              aria-label="Résultats"
              className="max-h-[56vh] overflow-y-auto p-1.5"
            >
              {items.length === 0 ? (
                <li className="px-3 py-6 text-center text-[13px] text-[var(--fg-muted)]">
                  Rien ne correspond. Essaie une adresse de site, par exemple acme.fr.
                </li>
              ) : null}
              {items.map((it, i) => {
                const header = it.group !== lastGroup ? it.group : null;
                lastGroup = it.group;
                return (
                  <li key={it.id} role="presentation">
                    {header ? (
                      <p
                        role="presentation"
                        className="px-2.5 pb-1 pt-2.5 text-[12px] text-[var(--fg-muted)]"
                      >
                        {header}
                      </p>
                    ) : null}
                    <div
                      id={`palette-${it.id}`}
                      role="option"
                      aria-selected={i === active}
                      data-index={i}
                      onMouseMove={() => {
                        setActive(i);
                      }}
                      onClick={() => {
                        it.run();
                      }}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px]',
                        i === active
                          ? 'bg-[var(--bg-subtle)] text-[var(--fg)]'
                          : 'text-[var(--fg)]',
                      )}
                    >
                      <span className="text-[var(--fg-muted)]">
                        {it.site ? (
                          <SiteIcon seed={it.site.host} faviconUrl={it.site.faviconUrl} size={16} />
                        ) : (
                          it.icon
                        )}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {it.hint ? (
                        <span className="text-[12px] text-[var(--fg-muted)]">{it.hint}</span>
                      ) : null}
                      {i === active ? (
                        <CornerDownLeft
                          className="h-3.5 w-3.5 text-[var(--fg-muted)]"
                          aria-hidden="true"
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-4 py-2 text-[12px] text-[var(--fg-muted)]">
              <span role="status" aria-live="polite">
                {pending ? 'Lancement de l’audit…' : message}
              </span>
              <span className="flex items-center gap-1.5">
                <kbd>↑</kbd>
                <kbd>↓</kbd> pour choisir, <kbd>Entrée</kbd> pour lancer
              </span>
            </div>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
