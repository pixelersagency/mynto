import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as ProbeModule from '../src/audit/ai-readiness/probe.js';
import type { ProbeResult } from '../src/audit/ai-readiness/probe.js';

const probeMock = vi.hoisted(() => vi.fn());

vi.mock('../src/audit/ai-readiness/probe.js', async (importOriginal) => {
  const actual = await importOriginal<typeof ProbeModule>();
  return { ...actual, probe: probeMock };
});

const { SiteUnreachableError, runAgentReadinessAudit } = await import('../src/audit/ai-readiness/index.js');

function errorProbe(url: string, reason: string): ProbeResult {
  return {
    url,
    status: 'error',
    ok: false,
    contentType: '',
    headers: {},
    body: '',
    preview: '',
    errorReason: reason,
  };
}

function okProbe(url: string, body: string, contentType: string): ProbeResult {
  return {
    url,
    status: 200,
    ok: true,
    contentType,
    headers: {},
    body,
    preview: body.slice(0, 160),
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

// The DNS-AID check talks to a public DoH resolver with a bare `fetch`,
// outside the mocked probe. Cut it here so the suite stays offline and
// deterministic; the check reports `skipped` when the resolver is mute.
vi.stubGlobal(
  'fetch',
  vi.fn(() => Promise.reject(new Error('offline in tests'))),
);

describe('runAgentReadinessAudit on an unreachable origin', () => {
  beforeEach(() => {
    probeMock.mockReset();
    logger.error.mockReset();
  });

  it('fails instead of publishing a 0/100 report', async () => {
    probeMock.mockImplementation((url: string) =>
      Promise.resolve(errorProbe(url, 'network_error:ENOTFOUND')),
    );

    await expect(runAgentReadinessAudit('https://example.com', logger)).rejects.toBeInstanceOf(
      SiteUnreachableError,
    );
    // A 0 published here would tell a healthy site it is invisible.
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ homeReason: 'network_error:ENOTFOUND' }),
      'ai_readiness_site_unreachable',
    );
  });

  it('carries the cause in the message so the job log names it', async () => {
    probeMock.mockImplementation((url: string) =>
      Promise.resolve(errorProbe(url, 'network_error:ECONNREFUSED')),
    );

    await expect(runAgentReadinessAudit('https://example.com', logger)).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  it('still audits when only the home page is unreachable', async () => {
    // robots.txt answering proves the origin is up: a timeout on one heavy
    // page is not a reason to throw the whole audit away.
    probeMock.mockImplementation((url: string) =>
      Promise.resolve(
        url.endsWith('/robots.txt')
          ? okProbe(url, 'User-agent: *\nDisallow:\n', 'text/plain')
          : errorProbe(url, 'network_error:timeout'),
      ),
    );

    const outcome = await runAgentReadinessAudit('https://example.com', logger);
    expect(outcome.checks.find((c) => c.id === 'robots_txt')?.status).toBe('pass');
  });
});
