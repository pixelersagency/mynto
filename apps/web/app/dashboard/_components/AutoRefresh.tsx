'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

import { mutationInFlight } from './mutation-lock';

/**
 * Re-renders the server page every `intervalMs` while audits are running
 * (the parent only mounts it then). Paused while the tab is hidden.
 */
export function AutoRefresh({ intervalMs }: { intervalMs: number }): React.ReactElement {
  const router = useRouter();
  useEffect(() => {
    const id = window.setInterval(() => {
      // Skipped while a delete / refresh is in flight (see mutation-lock).
      if (document.visibilityState === 'visible' && !mutationInFlight()) router.refresh();
    }, intervalMs);
    return () => {
      window.clearInterval(id);
    };
  }, [router, intervalMs]);
  return (
    <p className="sr-only" role="status">
      Des audits sont en cours, la liste se met à jour toute seule.
    </p>
  );
}
