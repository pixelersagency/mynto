import { describe, expect, it } from 'vitest';

import { decideRefresh } from '../src/lib/radar/refresh.js';

const now = new Date('2026-11-06T12:00:00Z');

describe('decideRefresh', () => {
  it('rescans completed scans older than 24h', () => {
    expect(decideRefresh({ status: 'completed', createdAt: '2026-10-08T12:00:00Z' }, now)).toBe(
      'refresh',
    );
  });

  it('keeps a scan made in the last 24h (idempotent retries)', () => {
    expect(decideRefresh({ status: 'completed', createdAt: '2026-11-06T02:00:00Z' }, now)).toBe(
      'fresh',
    );
  });

  it('never starts a second scan while one is queued or running', () => {
    expect(decideRefresh({ status: 'queued', createdAt: '2026-10-01T00:00:00Z' }, now)).toBe(
      'in_progress',
    );
    expect(decideRefresh({ status: 'running', createdAt: '2026-10-01T00:00:00Z' }, now)).toBe(
      'in_progress',
    );
  });

  it('always rescans a failed scan', () => {
    expect(decideRefresh({ status: 'failed', createdAt: '2026-11-06T11:00:00Z' }, now)).toBe(
      'refresh',
    );
  });
});
