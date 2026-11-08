import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { buildUserPrompt } from '../src/audit/llm/prompts.js';
import { applyFindingNarratives, buildNarrativeFields } from '../src/audit/narrative.js';
import { findingToRow } from '../src/audit/persist.js';
import type { Finding } from '../src/audit/types.js';
import { pickReusableAudit, type CacheCandidate } from '../src/lib/radar/cache.js';
import {
  nextParisMidnight,
  parisDayKey,
  quotaKey,
  releaseQuotaSlot,
  reserveQuotaSlot,
  type QuotaRedis,
} from '../src/lib/radar/quota.js';
import { rebuildRunInput } from '../src/lib/radar/rebuild.js';
import {
  axesFromScores,
  summarizeFindings,
  toGlobalScore100,
  toRadarStatus,
} from '../src/lib/radar/summary.js';
import {
  TRACKING_TOKEN_PATTERN,
  constantTimeEqual,
  generateTrackingToken,
  trackingUrl,
  verifyBearer,
} from '../src/lib/radar/tokens.js';
import { isBlockedViewerUserAgent } from '../src/lib/radar/ua-filter.js';
import {
  RadarViewBodySchema,
  hashIp,
  userAgentFamily,
  viewHashSecret,
} from '../src/lib/radar/views.js';
import { buildWebhookHeaders, isRetryableStatus, signWebhook } from '../src/lib/radar/webhook.js';

// ---------------------------------------------------------------------------
// UA filtering
// ---------------------------------------------------------------------------

const CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const CUBOT =
  'Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

describe('isBlockedViewerUserAgent', () => {
  it('accepts real browsers', () => {
    expect(isBlockedViewerUserAgent(CHROME)).toBe(false);
    expect(isBlockedViewerUserAgent(IPHONE)).toBe(false);
    expect(isBlockedViewerUserAgent(CUBOT)).toBe(false);
  });

  it.each([
    [
      'BingPreview (Safe Links)',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) BingPreview/1.0b',
    ],
    [
      'HeadlessChrome',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36',
    ],
    ['Proofpoint', 'Mozilla/5.0 (compatible; Proofpoint URL Defense)'],
    ['Mimecast', 'Mozilla/5.0 (compatible; Mimecast Link Scanner)'],
    ['Barracuda', 'Mozilla/5.0 Barracuda Sentinel'],
    ['Googlebot', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
    ['generic crawler', 'Mozilla/5.0 (compatible; SomeCrawler/1.0)'],
    ['spider', 'Mozilla/5.0 (compatible; Baiduspider/2.0)'],
    ['link preview', 'Mozilla/5.0 (compatible; LinkPreview/1.0)'],
    ['scanner', 'Mozilla/5.0 (compatible; SecurityScanner/3.1)'],
    ['GPTBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)'],
  ])('blocks %s', (_label, ua) => {
    expect(isBlockedViewerUserAgent(ua)).toBe(true);
  });

  it('blocks libraries and empty agents', () => {
    expect(isBlockedViewerUserAgent('python-requests/2.31.0')).toBe(true);
    expect(isBlockedViewerUserAgent('curl/8.4.0')).toBe(true);
    expect(isBlockedViewerUserAgent('')).toBe(true);
    expect(isBlockedViewerUserAgent(undefined)).toBe(true);
    expect(isBlockedViewerUserAgent(null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Quota (Paris day)
// ---------------------------------------------------------------------------

class FakeRedis implements QuotaRedis {
  store = new Map<string, number>();
  ttl = new Map<string, number>();
  fail = false;
  incr(key: string): Promise<number> {
    if (this.fail) return Promise.reject(new Error('down'));
    const next = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, next);
    return Promise.resolve(next);
  }
  decr(key: string): Promise<number> {
    const next = (this.store.get(key) ?? 0) - 1;
    this.store.set(key, next);
    return Promise.resolve(next);
  }
  expire(key: string, seconds: number): Promise<number> {
    this.ttl.set(key, seconds);
    return Promise.resolve(1);
  }
}

describe('Paris day helpers', () => {
  it('uses the Paris calendar day, not UTC', () => {
    // 23:30 UTC on 7 Oct = 01:30 on 8 Oct in Paris (UTC+2, summer time).
    expect(parisDayKey(new Date('2026-10-07T23:30:00Z'))).toBe('2026-10-08');
    expect(parisDayKey(new Date('2026-10-07T21:30:00Z'))).toBe('2026-10-07');
    // Winter time (UTC+1).
    expect(parisDayKey(new Date('2026-01-15T23:30:00Z'))).toBe('2026-01-16');
  });

  it('computes the next Paris midnight', () => {
    expect(nextParisMidnight(new Date('2026-10-08T10:00:00Z')).toISOString()).toBe(
      '2026-10-08T22:00:00.000Z',
    );
    expect(nextParisMidnight(new Date('2026-01-15T10:00:00Z')).toISOString()).toBe(
      '2026-01-15T23:00:00.000Z',
    );
  });

  it('handles DST switch days', () => {
    // 25 Oct 2026: clocks go back, next midnight (26 Oct) is UTC+1.
    expect(nextParisMidnight(new Date('2026-10-25T10:00:00Z')).toISOString()).toBe(
      '2026-10-25T23:00:00.000Z',
    );
    // 29 Mar 2026: clocks go forward, next midnight (30 Mar) is UTC+2.
    expect(nextParisMidnight(new Date('2026-03-29T10:00:00Z')).toISOString()).toBe(
      '2026-03-29T22:00:00.000Z',
    );
  });
});

describe('reserveQuotaSlot', () => {
  const now = new Date('2026-10-08T10:00:00Z');

  it('allows up to the limit then refuses with resets_at', async () => {
    const redis = new FakeRedis();
    for (let i = 1; i <= 3; i++) {
      const r = await reserveQuotaSlot(redis, 3, now);
      expect(r).toEqual({ ok: true, key: 'radar:quota:2026-10-08', count: i });
    }
    const refused = await reserveQuotaSlot(redis, 3, now);
    expect(refused).toEqual({
      ok: false,
      reason: 'quota_exceeded',
      limit: 3,
      resetsAt: '2026-10-08T22:00:00.000Z',
    });
    // Rolled back: refused calls do not keep the counter climbing.
    expect(redis.store.get(quotaKey(now))).toBe(3);
    expect(redis.ttl.get(quotaKey(now))).toBe(48 * 3600);
  });

  it('releases a slot', async () => {
    const redis = new FakeRedis();
    const r = await reserveQuotaSlot(redis, 1, now);
    expect(r.ok).toBe(true);
    if (r.ok) await releaseQuotaSlot(redis, r.key);
    expect((await reserveQuotaSlot(redis, 1, now)).ok).toBe(true);
  });

  it('uses a new counter on the next Paris day', async () => {
    const redis = new FakeRedis();
    await reserveQuotaSlot(redis, 1, now);
    expect((await reserveQuotaSlot(redis, 1, now)).ok).toBe(false);
    expect((await reserveQuotaSlot(redis, 1, new Date('2026-10-08T22:30:00Z'))).ok).toBe(true);
  });

  it('fails closed when Redis is down', async () => {
    const redis = new FakeRedis();
    redis.fail = true;
    expect(await reserveQuotaSlot(redis, 20, now)).toEqual({
      ok: false,
      reason: 'backend_unavailable',
    });
  });

  it('refuses everything with a zero limit', async () => {
    const r = await reserveQuotaSlot(new FakeRedis(), 0, now);
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tokens and auth
// ---------------------------------------------------------------------------

describe('tracking tokens', () => {
  it('are URL-safe, >= 22 chars and unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = generateTrackingToken();
      expect(t.length).toBeGreaterThanOrEqual(22);
      expect(t).toMatch(TRACKING_TOKEN_PATTERN);
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
      seen.add(t);
    }
    expect(seen.size).toBe(200);
  });

  it('builds the tracking url', () => {
    expect(trackingUrl('https://audit.example.com/', 'abc')).toBe(
      'https://audit.example.com/r/abc',
    );
  });
});

describe('verifyBearer', () => {
  const key = 'k'.repeat(40);
  it('accepts the right key only', () => {
    expect(verifyBearer(`Bearer ${key}`, key)).toBe(true);
    expect(verifyBearer(`Bearer ${key}x`, key)).toBe(false);
    expect(verifyBearer(key, key)).toBe(false);
    expect(verifyBearer(undefined, key)).toBe(false);
    expect(verifyBearer('Bearer ', key)).toBe(false);
    expect(verifyBearer([`Bearer ${key}`], key)).toBe(true);
  });
  it('compares in constant time without throwing on length mismatch', () => {
    expect(constantTimeEqual('a', 'abcdef')).toBe(false);
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Webhook signing
// ---------------------------------------------------------------------------

describe('webhook signing', () => {
  const secret = 's'.repeat(32);
  const body = JSON.stringify({
    tracking_token: 'tok',
    event: 'audit_viewed',
    occurred_at: '2026-10-08T10:14:03.000Z',
    duration_s: 42,
    sections_viewed: ['performance'],
  });

  it('matches the Radar contract (sha256 of "ts.body")', () => {
    const ts = '1791454443';
    const expected = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    expect(signWebhook(secret, ts, body)).toBe(`sha256=${expected}`);
  });

  it('builds timestamped headers', () => {
    const now = new Date('2026-10-08T10:14:03Z');
    const h = buildWebhookHeaders(secret, body, now);
    expect(h['X-Mynto-Timestamp']).toBe('1791454443');
    expect(h['X-Mynto-Signature']).toBe(signWebhook(secret, '1791454443', body));
    expect(h['Content-Type']).toBe('application/json');
  });

  it('retries only on 5xx and 429', () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(200)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 30-day cache decision
// ---------------------------------------------------------------------------

describe('pickReusableAudit', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const c = (id: string, status: string, created: string, expires = '2027-04-01T00:00:00Z') =>
    ({
      auditId: id,
      auditStatus: status,
      auditCreatedAt: created,
      auditExpiresAt: expires,
    }) satisfies CacheCandidate;

  it('reuses the most recent non-failed audit under 30 days', () => {
    const picked = pickReusableAudit(
      [
        c('old', 'completed', '2026-09-20T00:00:00Z'),
        c('new', 'completed', '2026-10-01T00:00:00Z'),
      ],
      now,
    );
    expect(picked?.auditId).toBe('new');
  });

  it('reuses queued and running scans', () => {
    expect(pickReusableAudit([c('q', 'queued', '2026-10-08T11:00:00Z')], now)?.auditId).toBe('q');
    expect(pickReusableAudit([c('r', 'running', '2026-10-08T11:00:00Z')], now)?.auditId).toBe('r');
  });

  it('skips failed, too old or expired audits', () => {
    expect(pickReusableAudit([c('f', 'failed', '2026-10-07T00:00:00Z')], now)).toBeNull();
    expect(pickReusableAudit([c('o', 'completed', '2026-09-08T11:00:00Z')], now)).toBeNull();
    expect(
      pickReusableAudit([c('e', 'completed', '2026-10-01T00:00:00Z', '2026-10-08T00:00:00Z')], now),
    ).toBeNull();
    expect(pickReusableAudit([], now)).toBeNull();
  });

  it('falls back to an older valid audit when the newest failed', () => {
    const picked = pickReusableAudit(
      [c('f', 'failed', '2026-10-07T00:00:00Z'), c('ok', 'completed', '2026-10-01T00:00:00Z')],
      now,
    );
    expect(picked?.auditId).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

describe('view helpers', () => {
  it('hashes the ip with a secret, never stores it raw', () => {
    const secret = 'x'.repeat(16);
    expect(hashIp('1.2.3.4', secret)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashIp('1.2.3.4', secret)).toBe(hashIp('1.2.3.4', secret));
    expect(hashIp('1.2.3.4', secret)).not.toBe(hashIp('1.2.3.5', secret));
    expect(hashIp(null, secret)).toBeNull();
  });

  it('falls back to a random per-process secret', () => {
    expect(viewHashSecret('configured-secret')).toBe('configured-secret');
    const a = viewHashSecret(undefined);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(viewHashSecret('')).not.toBe(a);
  });

  it('keeps only a coarse browser family', () => {
    expect(userAgentFamily(CHROME)).toBe('Chrome, ordinateur');
    expect(userAgentFamily(IPHONE)).toBe('Safari, mobile');
    expect(userAgentFamily('')).toBeNull();
    expect(userAgentFamily(undefined)).toBeNull();
    expect((userAgentFamily('Mozilla/5.0 ' + 'x'.repeat(1000)) ?? '').length).toBeLessThanOrEqual(
      200,
    );
  });

  it('validates the beacon body: token only, legacy fields dropped', () => {
    const token = generateTrackingToken();
    const ok = RadarViewBodySchema.safeParse({
      token,
      session_id: 'abcdEFGH1234',
      duration_s: 7,
      sections_viewed: ['performance'],
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toEqual({ token });
    expect(RadarViewBodySchema.safeParse({ token: 'short' }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// API summary
// ---------------------------------------------------------------------------

describe('radar summary', () => {
  it('maps statuses', () => {
    expect(toRadarStatus('queued')).toBe('pending');
    expect(toRadarStatus('running')).toBe('running');
    expect(toRadarStatus('completed')).toBe('done');
    expect(toRadarStatus('failed')).toBe('failed');
  });

  it('converts the 0-10 global score to a 0-100 integer', () => {
    expect(toGlobalScore100(5.4)).toBe(54);
    expect(toGlobalScore100('6.25')).toBe(63);
    expect(toGlobalScore100(null)).toBeNull();
  });

  it('flattens axis scores', () => {
    expect(
      axesFromScores({ seo_technique: { score: 7.5, band: 'good', weight: 1 }, ux: { score: 4 } }),
    ).toEqual({ seo_technique: 7.5, ux: 4 });
    expect(axesFromScores(null)).toEqual({});
  });

  it('sorts findings by severity deterministically and caps at 15', () => {
    const rows = [
      { axis: 'ux', severity: 'P2', title: 'B' },
      { axis: 'seo_technique', severity: 'P0', title: 'Z' },
      { axis: 'conformite', severity: 'P0', title: 'A' },
      { axis: 'ui', severity: 'P1', title: 'C' },
      { bogus: true },
      ...Array.from({ length: 20 }, (_, i) => ({
        axis: 'ui',
        severity: 'P3',
        title: `t${i.toString()}`,
      })),
    ];
    const out = summarizeFindings(rows);
    expect(out).toHaveLength(15);
    expect(out.slice(0, 4).map((f) => f.title)).toEqual(['A', 'Z', 'C', 'B']);
    expect(summarizeFindings([...rows].reverse())).toEqual(out);
  });
});

// ---------------------------------------------------------------------------
// RunInput rebuild from persisted rows
// ---------------------------------------------------------------------------

function sampleFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'seo.sitemap.missing:abc',
    ruleCode: 'seo.sitemap.missing',
    axis: 'seo_technique',
    severity: 'P1',
    title: 'Sitemap introuvable',
    evidence: { tried: 4 },
    affectedUrls: ['https://exemple.fr/sitemap.xml'],
    legalRefs: [{ standard: 'GOOGLE', label: 'Sitemaps' }],
    effortDefault: 'quick_win',
    kind: 'deterministic',
    occurrences: 1,
    ...overrides,
  };
}

const sampleFacts = {
  url: 'https://exemple.fr',
  scannedAt: '2026-10-08T10:00:00Z',
  stack: { stack: 'wordpress', confidence: 0.9, evidence: [] },
  meta: {
    title: 'Exemple',
    metaDescription: null,
    htmlLang: 'fr',
    viewport: null,
    canonical: null,
    jsonLd: [],
    og: {},
    twitter: {},
    hreflangs: [],
  },
  http: { finalUrl: 'https://exemple.fr', status: 200, isHttps: true },
  sitemap: {
    found: false,
    foundAt: null,
    urlsCount: 0,
    declaredInRobots: false,
    triedLocations: [],
  },
  robots: { present: true, blocksAiBots: [], hasDisallowAll: false },
  legal: { mentionsLegalesUrl: null, trackersDetected: [] },
  images: { total: 1 },
  headings: { h1Count: 1, h1Texts: ['Exemple'] },
  conversion: {},
  content: {},
  ux: {},
  ui: {},
  lighthouse: { fetched: false },
  axe: { fetched: false, violations: [] },
  fakeOnePageDetected: false,
};

describe('rebuildRunInput', () => {
  const finding = sampleFinding();
  const row = findingToRow(finding, 'audit-1');

  it('rebuilds findings, scores and llm input from persisted rows', () => {
    const r = rebuildRunInput({
      facts: sampleFacts,
      axisScores: {
        ux: { score: 6, band: 'fair', weight: 1 },
        seo_technique: { score: 4.5, band: 'poor', weight: 1.5 },
      },
      llmInput: {
        sectorHints: { detected: 'artisan' },
        internalPagesSample: ['https://exemple.fr/contact'],
        homeHtmlExcerpt: '<h1>Exemple</h1>',
      },
      findingRows: [row, { garbage: true }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.findings).toEqual([finding]);
    // Canonical axis order, not insertion order.
    expect(r.input.scores.map((s) => s.axis)).toEqual(['ux', 'seo_technique']);
    expect(r.input.sectorHints).toEqual({ detected: 'artisan' });
    expect(r.input.internalPagesSample).toEqual(['https://exemple.fr/contact']);
    expect(r.input.homeHtmlExcerpt).toBe('<h1>Exemple</h1>');
    // The prompt builder accepts the rebuilt input as-is.
    const prompt = buildUserPrompt(r.input);
    expect(prompt).toContain('seo.sitemap.missing:abc');
    expect(prompt).toContain('https://exemple.fr');
  });

  it('defaults a missing llm_input and a null effort', () => {
    const r = rebuildRunInput({
      facts: sampleFacts,
      axisScores: { ux: { score: 6, band: 'fair', weight: 1 } },
      llmInput: null,
      findingRows: [{ ...row, effort: null, affected_urls: null }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.findings[0]?.effortDefault).toBe('standard');
    expect(r.input.findings[0]?.affectedUrls).toEqual([]);
    expect(r.input.homeHtmlExcerpt).toBe('');
  });

  it('refuses unusable rows', () => {
    expect(
      rebuildRunInput({ facts: {}, axisScores: {}, llmInput: null, findingRows: [row] }),
    ).toEqual({ ok: false, error: 'invalid_facts' });
    expect(
      rebuildRunInput({ facts: sampleFacts, axisScores: {}, llmInput: null, findingRows: [row] }),
    ).toEqual({ ok: false, error: 'no_axis_scores' });
    expect(
      rebuildRunInput({
        facts: sampleFacts,
        axisScores: { ux: { score: 6, band: 'fair', weight: 1 } },
        llmInput: null,
        findingRows: [],
      }),
    ).toEqual({ ok: false, error: 'no_findings' });
  });
});

// ---------------------------------------------------------------------------
// Shared narrative application
// ---------------------------------------------------------------------------

describe('narrative application', () => {
  it('applies the LLM output to findings and report fields', () => {
    const findings = [sampleFinding()];
    const llmOutput = {
      sector: {
        detected: 'artisan menuisier',
        confidence: 0.8,
        mainKpi: 'demandes de devis',
        secondaryKpi: 'appels',
        audienceNotes: '',
      },
      execSummary: 'x'.repeat(100),
      globalBand: 'fair' as const,
      top3Priorities: [
        {
          title: 'Activer le SEO local',
          reason: 'r'.repeat(30),
          findingIds: [findings[0]?.id ?? ''],
        },
        { title: 'Rassurer le visiteur', reason: 'r'.repeat(30), findingId: findings[0]?.id },
        { title: 'Accélérer la page', reason: 'r'.repeat(30), findingIds: [findings[0]?.id ?? ''] },
      ],
      quickWins: ['Publier un sitemap XML'],
      killerFindings: ['Sitemap absent'],
      estimatedImpactNarrative: 'i'.repeat(50),
      findings: [
        {
          findingId: 'seo.sitemap.missing:abc',
          title: 'Google ne trouve pas tes pages',
          constat: 'c',
          impactBusiness: 'b',
          recommandation: 'r',
          severity: 'P0' as const,
          effort: 'standard' as const,
        },
      ],
    };
    applyFindingNarratives(findings, llmOutput);
    expect(findings[0]?.title).toBe('Google ne trouve pas tes pages');
    expect(findings[0]?.severity).toBe('P0');
    expect(findings[0]?.effortDefault).toBe('standard');
    expect(findings[0]?.narrative?.constat).toBe('c');

    const fields = buildNarrativeFields({
      facts: sampleFacts as never,
      findings,
      scores: [{ axis: 'seo_technique', score: 4, band: 'poor', weight: 1 }],
      sectorHints: {},
      globalScore: 4,
      llmOutput,
    });
    expect(fields.sector.detected).toBe('artisan menuisier');
    expect(fields.top3Priorities[1]?.findingIds).toEqual(['seo.sitemap.missing:abc']);
    expect(fields.killerFindings).toEqual(['Sitemap absent']);
  });

  it('falls back to deterministic fields without LLM output', () => {
    const findings = [sampleFinding({ severity: 'P0' })];
    applyFindingNarratives(findings, undefined);
    expect(findings[0]?.narrative).toBeUndefined();
    const fields = buildNarrativeFields({
      facts: sampleFacts as never,
      findings,
      scores: [{ axis: 'seo_technique', score: 4, band: 'poor', weight: 1 }],
      sectorHints: { detected: 'artisan' },
      globalScore: 4,
    });
    expect(fields.sector.detected).toBe('artisan');
    expect(fields.execSummary).toContain('Score global 40/100');
    expect(fields.quickWins).toEqual(['Sitemap introuvable']);
    expect(fields.killerFindings).toEqual([]);
  });
});
