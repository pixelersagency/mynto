'use client';

import { useEffect, useState } from 'react';

/**
 * Wires the template buttons (no script lives in a template):
 * data-mynto-action="copy" data-mynto-value="<url>" copies the link and
 * swaps the label to data-mynto-done for a few seconds.
 */
export function ReportActions(): React.ReactElement {
  const [message, setMessage] = useState('');
  useEffect(() => {
    // An in-report link (#anchor) can target a finding inside a closed
    // <details>: open every enclosing disclosure, then move focus there.
    const reveal = (hash: string): void => {
      if (hash.length < 2) return;
      let el: HTMLElement | null = null;
      try {
        el = document.getElementById(decodeURIComponent(hash.slice(1)));
      } catch {
        return;
      }
      if (!el?.closest('.mynto-report')) return;
      for (let d = el.closest('details'); d; d = d.parentElement?.closest('details') ?? null) {
        d.open = true;
      }
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: 'start' });
    };
    const onHash = (): void => {
      reveal(window.location.hash);
    };
    const onClick = (e: MouseEvent): void => {
      const target = e.target instanceof Element ? e.target : null;
      const link = target?.closest<HTMLAnchorElement>('.mynto-report a[href^="#"]');
      if (link) {
        const hash = link.getAttribute('href') ?? '';
        if (hash === window.location.hash) reveal(hash);
        return;
      }
      const btn = target?.closest<HTMLElement>('[data-mynto-action="copy"]');
      if (!btn) return;
      e.preventDefault();
      const value = btn.dataset.myntoValue ?? window.location.href;
      const label = btn.querySelector<HTMLElement>('[data-mynto-label]') ?? btn;
      const initial = label.textContent;
      const done = (text: string): void => {
        label.textContent = text;
        setMessage(text);
        btn.dataset.myntoState = 'done';
        window.setTimeout(() => {
          label.textContent = initial;
          delete btn.dataset.myntoState;
          setMessage('');
        }, 2_500);
      };
      void navigator.clipboard
        .writeText(value)
        .then(() => {
          done(btn.dataset.myntoDone ?? 'Lien copié');
        })
        .catch(() => {
          window.prompt('Copie ce lien :', value);
        });
    };
    document.addEventListener('click', onClick);
    window.addEventListener('hashchange', onHash);
    reveal(window.location.hash);
    return () => {
      document.removeEventListener('click', onClick);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {message}
    </p>
  );
}
