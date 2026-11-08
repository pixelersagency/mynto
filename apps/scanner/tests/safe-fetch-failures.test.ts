import { describe, expect, it, vi } from 'vitest';

import { safeFetch } from '../src/audit/collectors/safe-fetch.js';

// A public IP literal skips DNS entirely, so these tests never touch the
// network or the machine's resolver.
const PUBLIC = 'https://93.184.215.14/';

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

describe('safeFetch failures', () => {
  it('names the guard that rejected the URL', async () => {
    const fetchImpl = vi.fn();
    const out = await safeFetch(
      'https://127.0.0.1/admin',
      {},
      fetchImpl as unknown as typeof fetch,
    );

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.kind).toBe('unsafe_url');
    expect(out.reason).toBe('private_ip_literal');
    // The guard fires before any request leaves.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reports a network failure instead of swallowing it', async () => {
    const err = new TypeError('fetch failed');
    (err as { cause?: unknown }).cause = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
      code: 'ENOTFOUND',
    });
    const fetchImpl = vi.fn().mockRejectedValue(err);

    const out = await safeFetch(PUBLIC, {}, fetchImpl as unknown as typeof fetch);

    expect(out.ok).toBe(false);
    if (out.ok) throw new Error('unreachable');
    expect(out.kind).toBe('network_error');
    // The cause is the whole point: "fetch failed" alone says nothing.
    expect(out.reason).toContain('ENOTFOUND');
  });

  it('keeps the reason short even on a long error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('x'.repeat(5_000)));
    const out = await safeFetch(PUBLIC, {}, fetchImpl as unknown as typeof fetch);

    if (out.ok) throw new Error('unreachable');
    expect(out.reason.length).toBeLessThanOrEqual(200);
  });

  it('reports an unparsable redirect target', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(302, { location: 'http://[bad' }));

    const out = await safeFetch(PUBLIC, {}, fetchImpl as unknown as typeof fetch);

    if (out.ok) throw new Error('unreachable');
    expect(out.kind).toBe('invalid_redirect');
  });

  it('reports an exhausted redirect budget', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(302, { location: PUBLIC }));

    const out = await safeFetch(PUBLIC, {}, fetchImpl as unknown as typeof fetch);

    if (out.ok) throw new Error('unreachable');
    expect(out.kind).toBe('redirect_loop');
  });

  it('returns the response on success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(204));

    const out = await safeFetch(PUBLIC, {}, fetchImpl as unknown as typeof fetch);

    expect(out.ok).toBe(true);
    if (!out.ok) throw new Error('unreachable');
    expect(out.response.status).toBe(204);
    expect(out.finalUrl).toBe(PUBLIC);
  });
});
