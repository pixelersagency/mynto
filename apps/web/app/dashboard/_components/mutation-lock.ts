/**
 * Shared flag between the audits table and the auto-refresh poller: while a
 * delete or refresh is in flight, the poller skips its tick so a refresh
 * started before the mutation cannot repaint the old list over it.
 */
let pending = 0;

export function beginMutation(): () => void {
  pending += 1;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    pending = Math.max(0, pending - 1);
  };
}

export function mutationInFlight(): boolean {
  return pending > 0;
}
