/**
 * Pure timing logic of the tracking link beacon (RadarViewBeacon).
 *
 * The beacon only says "this link was opened" (CNIL art. 82: no browser
 * storage, no reading time, no sections). It fires once, after the tab
 * has been VISIBLE for 5 cumulated seconds: a mail gateway that opens the
 * link in a headless browser, or a tab opened in the background and
 * closed, never reaches that. Kept free of DOM access so it is
 * unit-testable.
 */

export const MIN_VISIBLE_MS = 5_000;

export interface VisibilityState {
  /** Visible time accumulated over finished visible stretches. */
  accumulatedMs: number;
  /** Start of the current visible stretch, null while hidden. */
  visibleSince: number | null;
}

export function startVisibility(now: number, visible: boolean): VisibilityState {
  return { accumulatedMs: 0, visibleSince: visible ? now : null };
}

export function setVisibility(
  state: VisibilityState,
  visible: boolean,
  now: number,
): VisibilityState {
  if (visible) {
    return state.visibleSince === null ? { ...state, visibleSince: now } : state;
  }
  if (state.visibleSince === null) return state;
  return {
    accumulatedMs: state.accumulatedMs + Math.max(0, now - state.visibleSince),
    visibleSince: null,
  };
}

export function visibleMs(state: VisibilityState, now: number): number {
  const current = state.visibleSince === null ? 0 : Math.max(0, now - state.visibleSince);
  return state.accumulatedMs + current;
}

export function shouldCountView(
  state: VisibilityState,
  now: number,
  alreadySent: boolean,
): boolean {
  return !alreadySent && visibleMs(state, now) >= MIN_VISIBLE_MS;
}

/** `?preview=1` (links opened from the dashboard) never emits anything. */
export function isPreviewSearch(search: string): boolean {
  const value = new URLSearchParams(search).get('preview');
  return value !== null && value !== '0' && value !== 'false';
}
