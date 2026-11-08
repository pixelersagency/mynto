'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

/**
 * Keyboard shortcuts of the dashboard. Ignored while typing in a field.
 *   ⌘K / Ctrl+K palette (CommandPalette), / search (sidebar), ? this help,
 *   n new audit, g h home, g a audits, g l links, g s settings.
 * In the audit record: Échap closes, ↑ ↓ move between audits.
 */

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['⌘', 'K'], label: 'Palette de commandes (Ctrl+K sous Windows et Linux)' },
  { keys: ['/'], label: 'Rechercher un audit' },
  { keys: ['N'], label: 'Nouvel audit' },
  { keys: ['G', 'H'], label: 'Aller à l’accueil' },
  { keys: ['G', 'A'], label: 'Aller aux audits' },
  { keys: ['G', 'L'], label: 'Aller aux liens de suivi' },
  { keys: ['G', 'S'], label: 'Aller aux réglages' },
  { keys: ['↑', '↓'], label: 'Fiche audit : audit précédent ou suivant' },
  { keys: ['Échap'], label: 'Fermer la fiche ou la fenêtre' },
  { keys: ['?'], label: 'Afficher cette aide' },
];

const GOTO: Record<string, string> = {
  h: '/dashboard',
  a: '/dashboard/audits',
  l: '/dashboard/liens',
  s: '/dashboard/reglages',
};

export function Shortcuts(): React.ReactElement {
  const router = useRouter();
  const [help, setHelp] = useState(false);

  useEffect(() => {
    let pendingG = 0;
    const onKey = (e: KeyboardEvent): void => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
      if (document.querySelector('[role="dialog"][data-state="open"]') && e.key !== '?') return;
      const key = e.key.toLowerCase();
      if (pendingG > Date.now()) {
        pendingG = 0;
        const href = GOTO[key];
        if (href) {
          e.preventDefault();
          router.push(href as '/dashboard');
        }
        return;
      }
      if (key === 'g') {
        pendingG = Date.now() + 1200;
      } else if (key === 'n') {
        e.preventDefault();
        router.push('/dashboard/nouveau');
      } else if (e.key === '?') {
        e.preventDefault();
        setHelp((h) => !h);
      }
    };
    const onHelp = (): void => {
      setHelp(true);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mynto:shortcuts', onHelp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mynto:shortcuts', onHelp);
    };
  }, [router]);

  return (
    <Dialog open={help} onOpenChange={setHelp}>
      <DialogContent className="max-w-md">
        <DialogTitle>Raccourcis clavier</DialogTitle>
        <DialogDescription>
          Ils ne s’activent pas pendant la saisie dans un champ.
        </DialogDescription>
        <dl className="mt-4 divide-y divide-[var(--border)]">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-4 py-2 text-[13px]">
              <dt>{s.label}</dt>
              <dd className="flex shrink-0 items-center gap-1">
                {s.keys.map((k, i) => (
                  <span key={`${k}-${String(i)}`} className="flex items-center gap-1">
                    {i > 0 && s.keys[0] === 'G' ? (
                      <span className="text-[11px] text-[var(--fg-muted)]">puis</span>
                    ) : null}
                    <kbd>{k}</kbd>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
