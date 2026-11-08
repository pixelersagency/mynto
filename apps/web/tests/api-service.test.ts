import type { DashboardAuditRow } from '@mynto/db';
import type { AiReadinessResult } from '@mynto/shared';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const { toApiAudit, toApiAiChecks, aiFindings } = await import('../lib/services/audits');
const { bearerToken } = await import('../lib/api/auth');
const { isSameOrigin } = await import('../lib/auth/origin');
const { openApiDocument, listOperations } = await import('../lib/api/openapi');
const { modulesFromForm, overrideFromModules } = await import('../lib/dashboard/modules-form');

function row(patch: Partial<DashboardAuditRow> = {}): DashboardAuditRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'abcdefghij12',
    url: 'https://acme.fr/',
    label: 'Acme',
    source: 'api',
    status: 'completed',
    created_at: '2026-11-01T10:00:00.000Z',
    expires_at: '2099-01-01T00:00:00.000Z',
    global_score: 7.24,
    global_band: 'good',
    axis_scores: { seo_technique: { score: 8, band: 'good' }, ui: { score: 0, band: 'critical' } },
    modules: {
      axes: ['seo_technique', 'performance'],
      lighthouse: true,
      vision: false,
      hero: true,
      narrative: true,
    },
    scanned_at: '2026-11-01T10:01:00.000Z',
    pages: 3,
    tracking_token: 'tok123',
    views_count: 2,
    last_viewed_at: null,
    favicon_key: null,
    hero_screenshot_key: null,
    template_id: null,
    progress_step: null,
    prev_score: null,
    ai_score: null,
    ai_level: null,
    ai_site_type: null,
    ai_site_type_auto: null,
    ai_status: null,
    ai_included_in_global_score: null,
    ...patch,
  };
}

describe('toApiAudit', () => {
  it('maps scores to /100, marks disabled axes as not evaluated, builds links', () => {
    const a = toApiAudit(row(), 'https://audit.agence.fr/');
    expect(a.score).toBe(72);
    expect(a.report_url).toBe('https://audit.agence.fr/audit/full/abcdefghij12');
    expect(a.tracking_url).toBe('https://audit.agence.fr/r/tok123');
    expect(a.axes.find((x) => x.axis === 'seo_technique')).toEqual({
      axis: 'seo_technique',
      evaluated: true,
      score: 80,
      band: 'good',
    });
    // Disabled axis: never a score, even if one is stored.
    expect(a.axes.find((x) => x.axis === 'ui')).toEqual({
      axis: 'ui',
      evaluated: false,
      score: null,
      band: null,
    });
    expect(Object.keys(a)).not.toContain('email');
    expect(Object.keys(a)).not.toContain('llm_input');
  });

  it('legacy rows evaluate only stored scores; radar reports link to the tracking URL', () => {
    const a = toApiAudit(row({ modules: null, source: 'radar' }), 'https://x.fr');
    expect(a.axes.filter((x) => x.evaluated).map((x) => x.axis)).toEqual(['seo_technique', 'ui']);
    expect(a.report_url).toBe('https://x.fr/r/tok123');
  });

  it('enabled axes without collector scores are not evaluated, including empty global coverage', () => {
    const a = toApiAudit(
      row({ axis_scores: {}, global_score: null, global_band: null }),
      'https://x.fr',
    );
    expect(a.axes.every((x) => !x.evaluated && x.score === null && x.band === null)).toBe(true);
    expect(a.score).toBeNull();
    expect(a.band).toBeNull();
  });

  it('expired and unfinished audits', () => {
    expect(toApiAudit(row({ expires_at: '2000-01-01T00:00:00.000Z' }), 'https://x.fr').status).toBe(
      'expired',
    );
    const q = toApiAudit(row({ status: 'queued', global_score: null }), 'https://x.fr');
    expect(q).toMatchObject({ status: 'queued', score: null });
  });
});

describe('api helpers', () => {
  it('parses Bearer tokens strictly', () => {
    expect(bearerToken('Bearer myn_live_abc')).toBe('myn_live_abc');
    expect(bearerToken('bearer   myn_live_abc ')).toBe('myn_live_abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer a b')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });

  it('same-origin check for mutations', () => {
    expect(isSameOrigin('http://localhost:3000', 'localhost:3000', 'http://localhost:3000')).toBe(
      true,
    );
    expect(isSameOrigin('https://audit.agence.fr', 'web:3000', 'https://audit.agence.fr')).toBe(
      true,
    );
    expect(isSameOrigin('https://evil.example', 'audit.agence.fr', 'https://audit.agence.fr')).toBe(
      false,
    );
    expect(isSameOrigin(null, 'audit.agence.fr', 'https://audit.agence.fr')).toBe(false);
    expect(isSameOrigin('null', 'audit.agence.fr', 'https://audit.agence.fr')).toBe(false);
  });

  it('OpenAPI 3.1 document lists every v1 operation', () => {
    const doc = openApiDocument('https://audit.agence.fr/');
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.servers).toEqual([{ url: 'https://audit.agence.fr/api/v1' }]);
    expect(listOperations(doc).map((o) => `${o.method} ${o.path}`)).toEqual([
      'GET /audits',
      'POST /audits',
      'GET /audits/{id}',
      'DELETE /audits/{id}',
      'POST /audits/{id}/refresh',
      'GET /audits/{id}/findings',
      'GET /templates',
      'GET /templates/{id}',
      'PUT /templates/{id}',
      'POST /templates/{id}/preview',
      'GET /report-data/schema',
      'GET /webhooks',
      'POST /webhooks',
      'GET /webhooks/{id}',
      'PATCH /webhooks/{id}',
      'DELETE /webhooks/{id}',
      'POST /webhooks/{id}/test',
      'POST /webhooks/{id}/rotate-secret',
      'GET /webhooks/{id}/deliveries',
      'GET /webhooks/{id}/deliveries/{deliveryId}',
      'POST /webhooks/{id}/deliveries/{deliveryId}/resend',
      'GET /analytics/summary',
    ]);
  });

  it('reads the modules fieldset', () => {
    const f = new FormData();
    f.append('axes', 'ui');
    f.append('axes', 'seo_technique');
    f.set('narrative', 'on');
    expect(modulesFromForm(f)).toEqual({
      ok: true,
      modules: {
        axes: ['seo_technique', 'ui'],
        lighthouse: false,
        vision: false,
        hero: false,
        narrative: true,
        ai_readiness: false,
        site_type: 'auto',
        ai_in_global_score: false,
      },
    });
    expect(modulesFromForm(new FormData())).toEqual({
      ok: false,
      error: 'Choisis au moins un axe.',
    });
  });
});

describe('Préparation IA in the API', () => {
  const stored: AiReadinessResult = {
    version: 1,
    status: 'completed',
    scanned_at: '2026-11-01T10:01:00.000Z',
    score: 40,
    level: 1,
    level_name: 'Présence de base',
    max_level: 3,
    site_type: 'vitrine',
    site_type_auto: true,
    site_type_signals: [],
    included_in_global_score: false,
    error: null,
    checks: [
      {
        id: 'robots_txt',
        category: 'discoverability',
        status: 'pass',
        message: 'robots.txt présent.',
        evidence: [],
        specUrls: [],
        weight: 3,
      },
      {
        id: 'no_js_content',
        category: 'content_accessibility',
        status: 'fail',
        message: 'Seulement 12 mots.',
        evidence: [],
        specUrls: [],
        weight: 3,
        fixPrompt: 'Rends le contenu côté serveur.',
      },
      {
        id: 'llms_txt',
        category: 'content_accessibility',
        status: 'fail',
        message: 'Aucun llms.txt.',
        evidence: [],
        specUrls: [],
        weight: 2,
        fixPrompt: 'Publie un llms.txt.',
      },
      {
        id: 'x402',
        category: 'commerce',
        status: 'neutral',
        message: 'Non applicable au type de site choisi.',
        evidence: [],
        specUrls: [],
        weight: 1,
        applicable: false,
      },
    ],
  };

  it('module off: not evaluated, never a score', () => {
    const a = toApiAudit(row(), 'https://x.fr');
    expect(a.ai_readiness).toEqual({
      evaluated: false,
      score: null,
      level: null,
      level_name: null,
      site_type: null,
      site_type_auto: null,
      included_in_global_score: false,
    });
  });

  it('module on: score, level and site type from the row', () => {
    const a = toApiAudit(
      row({
        ai_score: 40,
        ai_level: 1,
        ai_site_type: 'vitrine',
        ai_site_type_auto: true,
        ai_status: 'completed',
        ai_included_in_global_score: false,
      }),
      'https://x.fr',
    );
    expect(a.ai_readiness).toMatchObject({
      evaluated: true,
      score: 40,
      level: 1,
      site_type: 'vitrine',
      site_type_auto: true,
    });
    // The global score stays the 8-axis one.
    expect(a.score).toBe(72);
  });

  it('failed tests become `ia` findings with rule codes, severity by weight', () => {
    const f = aiFindings('11111111-1111-4111-8111-111111111111', stored);
    expect(f.map((x) => [x.rule_code, x.axis, x.severity])).toEqual([
      ['ia.no_js_content', 'ia', 'P1'],
      ['ia.llms_txt', 'ia', 'P2'],
    ]);
    expect(f[1]?.recommendation).toBe('Publie un llms.txt.');
    expect(f[1]?.title).toBe('llms.txt : Aucun llms.txt.');
  });

  it('per-test detail keeps out-of-scope tests flagged', () => {
    const checks = toApiAiChecks(stored);
    expect(checks).toHaveLength(4);
    expect(checks.find((c) => c.id === 'x402')).toMatchObject({
      applicable: false,
      status: 'neutral',
      fix: null,
    });
    expect(checks.find((c) => c.id === 'llms_txt')?.rule_code).toBe('ia.llms_txt');
  });

  it('the dashboard form reads the AI module, the override never carries the install setting', () => {
    const f = new FormData();
    f.append('axes', 'ui');
    f.append('ai_readiness', 'on');
    f.append('site_type', 'ecommerce');
    f.append('ai_in_global_score', 'on');
    const res = modulesFromForm(f);
    expect(res).toMatchObject({
      ok: true,
      modules: { ai_readiness: true, site_type: 'ecommerce', ai_in_global_score: true },
    });
    if (!res.ok) throw new Error('unreachable');
    const override = overrideFromModules(res.modules);
    expect(override).toMatchObject({ ai_readiness: true, site_type: 'ecommerce' });
    expect('ai_in_global_score' in override).toBe(false);
    const bad = new FormData();
    bad.append('axes', 'ui');
    bad.append('site_type', 'boutique');
    expect(modulesFromForm(bad)).toEqual({ ok: false, error: 'Sélection invalide.' });
  });
});
