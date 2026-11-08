'use client';

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** A decorative screenshot, requested only while the site identity is active. */
export function SitePreview({
  heroUrl,
  children,
}: {
  heroUrl: string | null;
  children: ReactNode;
}): ReactElement {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false);
  const focused = useRef(false);
  const [open, setOpen] = useState(false);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 240, height: 150 });
  const active = open && heroUrl !== null && failedUrl !== heroUrl;

  function cancelTimer(): void {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }

  function show(): void {
    cancelTimer();
    if (heroUrl && failedUrl !== heroUrl) setOpen(true);
  }

  function scheduleClose(): void {
    cancelTimer();
    timer.current = setTimeout(() => {
      if (!hovered.current && !focused.current) setOpen(false);
    }, 120);
  }

  useEffect(
    () => () => {
      cancelTimer();
    },
    [],
  );

  useEffect(() => {
    if (!active) return;
    function place(): void {
      const rect = anchor.current?.getBoundingClientRect();
      if (!rect) return;
      const margin = 8;
      const width = Math.min(240, Math.max(0, window.innerWidth - margin * 2));
      const height = Math.min((width * 150) / 240, Math.max(0, window.innerHeight - margin * 2));
      if (
        rect.bottom <= 0 ||
        rect.top >= window.innerHeight ||
        rect.right <= 0 ||
        rect.left >= window.innerWidth
      ) {
        setOpen(false);
        return;
      }
      const below = rect.bottom + margin;
      const top =
        below + height <= window.innerHeight - margin ? below : rect.top - margin - height;
      setPosition({
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - width - margin)),
        top: Math.max(margin, Math.min(top, window.innerHeight - height - margin)),
        width,
        height,
      });
    }
    function dismiss(event: KeyboardEvent): void {
      if (event.key === 'Escape') setOpen(false);
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('keydown', dismiss);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('keydown', dismiss);
    };
  }, [active]);

  return (
    <span
      ref={anchor}
      className="inline-flex min-w-0 items-center gap-2.5"
      onMouseEnter={() => {
        hovered.current = true;
        show();
      }}
      onMouseLeave={() => {
        hovered.current = false;
        scheduleClose();
      }}
      onFocus={() => {
        focused.current = true;
        show();
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        focused.current = false;
        scheduleClose();
      }}
    >
      {children}
      {active &&
        createPortal(
          <span
            aria-hidden="true"
            data-site-preview=""
            className="fixed z-40 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-[var(--shadow-pop)]"
            style={{ ...position, visibility: loadedUrl === heroUrl ? 'visible' : 'hidden' }}
            onMouseEnter={() => {
              hovered.current = true;
              cancelTimer();
            }}
            onMouseLeave={() => {
              hovered.current = false;
              scheduleClose();
            }}
          >
            <img
              src={heroUrl}
              alt=""
              width={240}
              height={150}
              className="block h-full w-full object-cover object-top"
              onLoad={() => {
                setLoadedUrl(heroUrl);
              }}
              onError={() => {
                setFailedUrl(heroUrl);
                setOpen(false);
              }}
            />
          </span>,
          document.body,
        )}
    </span>
  );
}
