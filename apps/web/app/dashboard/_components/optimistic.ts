import type { DisplayStatus } from '@/lib/dashboard/format';

/**
 * Optimistic view of the audits list.
 *
 * - `removed`: ids deleted from this tab. They stay hidden for the life of
 *   the component, even when a late server render (auto-refresh started
 *   before the delete) still contains them: a deleted UUID never comes back.
 * - `refreshing`: ids whose rescan was requested. A refresh moves the
 *   report to a new scan id, so the old row shows "En cours" until the
 *   server list no longer contains it.
 */
export function applyOptimistic<
  T extends { id: string; status: DisplayStatus; score: number | null },
>(rows: readonly T[], removed: ReadonlySet<string>, refreshing: ReadonlySet<string>): T[] {
  const out: T[] = [];
  for (const r of rows) {
    if (removed.has(r.id)) continue;
    out.push(refreshing.has(r.id) ? { ...r, status: 'running', score: null } : r);
  }
  return out;
}
