'use client';

import { useEffect } from 'react';

import {
  isPreviewSearch,
  setVisibility,
  shouldCountView,
  startVisibility,
  type VisibilityState,
} from '@/lib/radar/beacon';

interface Props {
  token: string;
}

const ENDPOINT = '/api/radar/view';
const TICK_MS = 1_000;

function send(token: string): void {
  const body = JSON.stringify({ token });
  try {
    const blob = new Blob([body], { type: 'application/json' });
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(ENDPOINT, blob)) return;
  } catch {
    // fall through to fetch
  }
  void fetch(ENDPOINT, {
    method: 'POST',
    body,
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
  }).catch(() => undefined);
}

/**
 * Tells the agency that the tracking link was opened, once, after ~5 s of
 * visible tab. Sends the token and nothing else: no storage, no reading
 * time, no sections, no identifier (CNIL art. 82, see the notice on the
 * page). The server dedupes on a hash of the IP for 30 minutes.
 * `?preview=1` (agency's own preview) sends nothing.
 *
 * Client Component: needs visibilitychange and sendBeacon. Renders nothing.
 */
export function RadarViewBeacon({ token }: Props): null {
  useEffect(() => {
    if (isPreviewSearch(window.location.search)) return;

    let state: VisibilityState = startVisibility(
      performance.now(),
      document.visibilityState === 'visible',
    );
    let sent = false;
    let interval = 0;

    const stop = (): void => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
    const tick = (): void => {
      if (shouldCountView(state, performance.now(), sent)) {
        sent = true;
        send(token);
        stop();
      }
    };
    function onVisibility(): void {
      state = setVisibility(state, document.visibilityState === 'visible', performance.now());
      tick();
    }

    interval = window.setInterval(tick, TICK_MS);
    document.addEventListener('visibilitychange', onVisibility);
    tick();
    return stop;
  }, [token]);

  return null;
}
