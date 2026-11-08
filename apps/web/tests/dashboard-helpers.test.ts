import { describe, expect, it } from 'vitest';

import { contrastRatio, readableTextOn } from '@/lib/color';
import {
  csvCell,
  displayStatus,
  previewPath,
  reportUrl,
  score100,
  scoreBand,
  siteName,
  toCsv,
  weakAxes,
} from '@/lib/dashboard/format';
import {
  listQuery,
  monthBounds,
  parseListParams,
  shiftMonth,
  toRepoFilter,
} from '@/lib/dashboard/params';
import { LOGO_MAX_BYTES, checkLogo } from '@/lib/logo';
import { buildCsp, securityHeaders } from '@/lib/security-headers';

describe('list params', () => {
  it('parses and defaults safely', () => {
    expect(parseListParams({})).toEqual({
      vue: 'tous',
      q: '',
      statut: null,
      tri: 'recent',
      mois: null,
      ia: null,
      page: 1,
    });
    const p = parseListParams({
      vue: 'echecs',
      q: '  boulangerie ',
      statut: 'termine',
      tri: 'score-bas',
      mois: '2026-11',
      page: '3',
    });
    expect(p).toMatchObject({ vue: 'echecs', q: 'boulangerie', statut: 'termine', page: 3 });
    expect(
      parseListParams({ vue: 'x', mois: '2026-13', page: '-2', tri: 'drop table' }),
    ).toMatchObject({
      vue: 'tous',
      mois: null,
      page: 1,
      tri: 'recent',
    });
  });

  it('maps views and explicit filters to the repo filter', () => {
    const now = new Date('2026-11-06T10:00:00Z');
    expect(toRepoFilter(parseListParams({ vue: 'en-cours' }), now).status).toBe('in_progress');
    expect(toRepoFilter(parseListParams({ vue: 'radar' }), now).source).toBe('radar');
    const month = toRepoFilter(parseListParams({ vue: 'mois' }), now);
    expect(month.createdFrom).toBe('2026-11-01T00:00:00.000Z');
    expect(month.createdTo).toBe('2026-12-01T00:00:00.000Z');
    // Explicit status wins over the view.
    expect(toRepoFilter(parseListParams({ vue: 'echecs', statut: 'expire' }), now).status).toBe(
      'expired',
    );
    expect(toRepoFilter(parseListParams({ page: '2' }), now).offset).toBe(25);
    // "Préparation IA faible".
    expect(toRepoFilter(parseListParams({ ia: 'faible' }), now).aiLow).toBe(true);
    expect(toRepoFilter(parseListParams({ ia: 'nimporte' }), now).aiLow).toBe(false);
    expect(listQuery({ ia: 'faible', page: 1 })).toBe('?ia=faible');
  });

  it('month helpers and query strings', () => {
    expect(monthBounds('2026-12')).toEqual({
      from: '2026-12-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
    });
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(listQuery({ vue: 'tous', tri: 'recent', page: 1 })).toBe('');
    expect(listQuery({ vue: 'radar', q: 'a b', page: 2 })).toBe('?vue=radar&q=a+b&page=2');
  });
});

describe('display helpers', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  it('derives the status shown', () => {
    expect(displayStatus('completed', future)).toBe('completed');
    expect(displayStatus('queued', future)).toBe('running');
    expect(displayStatus('running', future)).toBe('running');
    expect(displayStatus('failed', future)).toBe('failed');
    expect(displayStatus('completed', new Date(Date.now() - 1000).toISOString())).toBe('expired');
  });

  it('scores and bands', () => {
    expect(score100(7.24)).toBe(72);
    expect(score100(null)).toBeNull();
    expect(scoreBand(80)).toBe('good');
    expect(scoreBand(60)).toBe('fair');
    expect(scoreBand(20)).toBe('poor');
  });

  it('lists the weakest axes first', () => {
    expect(
      weakAxes({
        performance: { score: 4.1 },
        ux: { score: 8 },
        conformite: { score: 2 },
        ui: { score: 5.9 },
        seo_contenu: { score: 5 },
      }),
    ).toEqual(['conformite', 'performance', 'seo_contenu']);
    expect(weakAxes(null)).toEqual([]);
    expect(weakAxes({ hack: { score: 1 } })).toEqual([]);
  });

  it('names sites', () => {
    expect(siteName('https://www.boulangerie-martin.fr/', null)).toBe('Boulangerie Martin');
    expect(siteName('https://x.fr/', '  Client A ')).toBe('Client A');
  });

  it('builds report links (tracking link first, preview never counts)', () => {
    expect(reportUrl('https://audit.agence.fr/', { tracking_token: 'tok', slug: 's' })).toBe(
      'https://audit.agence.fr/r/tok',
    );
    expect(reportUrl('https://audit.agence.fr', { tracking_token: null, slug: 's' })).toBe(
      'https://audit.agence.fr/audit/full/s',
    );
    expect(previewPath({ tracking_token: 'tok', slug: 's' })).toBe('/r/tok?preview=1');
    expect(previewPath({ tracking_token: null, slug: 's' })).toBe('/audit/full/s?preview=1');
  });

  it('writes CSV safely (quotes, formulas)', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell(-1)).toBe('-1');
    expect(csvCell(null)).toBe('');
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('a,b\r\n1,x\r\n');
  });
});

describe('logo upload checks', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  it('accepts PNG and JPEG by magic bytes', () => {
    expect(checkLogo(png)).toMatchObject({ ok: true, ext: 'png' });
    expect(checkLogo(jpg)).toMatchObject({ ok: true, ext: 'jpg' });
  });
  it('rejects SVG, other formats, empty and oversized files', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
    expect(checkLogo(svg).ok).toBe(false);
    expect(checkLogo(new TextEncoder().encode('GIF89a')).ok).toBe(false);
    expect(checkLogo(new Uint8Array()).ok).toBe(false);
    const big = new Uint8Array(LOGO_MAX_BYTES + 1);
    big.set(png);
    expect(checkLogo(big).ok).toBe(false);
  });
});

describe('colors', () => {
  it('picks a readable text color', () => {
    expect(readableTextOn('#2563EB')).toBe('#ffffff');
    expect(readableTextOn('#F5CE4B')).toBe('#111827');
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
});

describe('security headers', () => {
  it('sends HSTS and upgrade-insecure-requests only on https', () => {
    const https = securityHeaders({ https: true, production: true });
    expect(https['Strict-Transport-Security']).toContain('max-age=');
    expect(https['Content-Security-Policy']).toContain('upgrade-insecure-requests');
    const http = securityHeaders({ https: false, production: true });
    expect(http['Strict-Transport-Security']).toBeUndefined();
    expect(http['Content-Security-Policy']).not.toContain('upgrade-insecure-requests');
    expect(securityHeaders({ https: true, production: false })).toEqual({});
    expect(buildCsp(false)).toContain("frame-ancestors 'none'");
  });
});

describe('interface v2 helpers', async () => {
  const { axisBars, scoreDelta, urlCandidate } = await import('../lib/dashboard/format');

  it('scoreDelta compares two scans on 100', () => {
    expect(scoreDelta(6.5, 5)).toBe(15);
    expect(scoreDelta(5, null)).toBeNull();
  });

  it('axisBars keeps the 8 axes in order, disabled ones as null', () => {
    const bars = axisBars(
      { seo_technique: { score: 7.2 }, ui: { score: 4 } },
      {
        axes: ['seo_technique', 'ui'],
        lighthouse: true,
        vision: true,
        hero: true,
        narrative: true,
      },
    );
    expect(bars).toHaveLength(8);
    expect(bars[0]).toMatchObject({ axis: 'seo_technique', value: 72 });
    expect(bars.find((b) => b.axis === 'performance')?.value).toBeNull();
  });

  it('urlCandidate recognises a pasted site address', () => {
    expect(urlCandidate('https://www.acme.fr/contact')).toBe('acme.fr');
    expect(urlCandidate('acme.fr')).toBe('acme.fr');
    expect(urlCandidate('boulangerie')).toBeNull();
    expect(urlCandidate('acme fr')).toBeNull();
  });
});
