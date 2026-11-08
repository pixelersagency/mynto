import { describe, expect, it } from 'vitest';

import {
  MIN_VISIBLE_MS,
  isPreviewSearch,
  setVisibility,
  shouldCountView,
  startVisibility,
  visibleMs,
} from '@/lib/radar/beacon';

describe('radar beacon visibility timing', () => {
  it('counts after 5 s of continuous visibility', () => {
    const s = startVisibility(0, true);
    expect(shouldCountView(s, 4_999, false)).toBe(false);
    expect(shouldCountView(s, MIN_VISIBLE_MS, false)).toBe(true);
  });

  it('never counts a tab opened in the background', () => {
    const s = startVisibility(0, false);
    expect(visibleMs(s, 60_000)).toBe(0);
    expect(shouldCountView(s, 60_000, false)).toBe(false);
  });

  it('cumulates visible stretches across visibility changes', () => {
    let s = startVisibility(0, true);
    s = setVisibility(s, false, 3_000); // 3 s visible
    s = setVisibility(s, true, 50_000); // hidden 47 s, not counted
    expect(shouldCountView(s, 51_000, false)).toBe(false); // 4 s
    expect(shouldCountView(s, 52_000, false)).toBe(true); // 5 s
    expect(visibleMs(s, 52_000)).toBe(5_000);
  });

  it('ignores repeated identical visibility events', () => {
    let s = startVisibility(0, true);
    s = setVisibility(s, true, 2_000);
    expect(visibleMs(s, 4_000)).toBe(4_000);
    s = setVisibility(s, false, 4_000);
    s = setVisibility(s, false, 9_000);
    expect(visibleMs(s, 20_000)).toBe(4_000);
  });

  it('sends only once', () => {
    const s = startVisibility(0, true);
    expect(shouldCountView(s, 10_000, true)).toBe(false);
  });
});

describe('radar beacon helpers', () => {
  it('detects preview links', () => {
    expect(isPreviewSearch('?preview=1')).toBe(true);
    expect(isPreviewSearch('?utm_source=x&preview=1')).toBe(true);
    expect(isPreviewSearch('?preview=0')).toBe(false);
    expect(isPreviewSearch('')).toBe(false);
  });
});
