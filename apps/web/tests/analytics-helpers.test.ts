import { describe, expect, it } from 'vitest';

import {
  compact,
  duration,
  niceMax,
  parsePeriod,
  percent,
  shortDay,
} from '../lib/dashboard/analytics';

describe('analytics helpers', () => {
  it('parses the period with a 30-day default', () => {
    expect(parsePeriod('7')).toBe(7);
    expect(parsePeriod(['90'])).toBe(90);
    expect(parsePeriod('12')).toBe(30);
    expect(parsePeriod(undefined)).toBe(30);
  });
  it('rounds axis maxima to clean numbers', () => {
    expect(niceMax(0)).toBe(5);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(13)).toBe(20);
    expect(niceMax(51)).toBe(100);
  });
  it('formats', () => {
    expect(shortDay('2026-10-05')).toBe('5 oct.');
    expect(percent(0.333)).toBe('33 %');
    expect(percent(null)).toBe('-');
    expect(duration(0.25)).toBe('15 min');
    expect(duration(3.46)).toBe('3,5 h');
    expect(duration(72)).toBe('3 j');
    expect(compact(1284)).toMatch(/^1\s?284$/);
  });
});
