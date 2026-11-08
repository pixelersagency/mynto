import {
  DEFAULT_AUDIT_MODULES,
  parseStoredAiReadiness,
  type AiCheckId,
  type AiCheckStatus,
  type AiReadinessResult,
} from '@mynto/shared';
import { describe, expect, it } from 'vitest';

import { PUBLIC_AUDIT_COLUMNS } from '../src/public-columns.js';

import { hasDatabase, testSlug, useTestDb } from './helpers.js';

function aiResult(score: number, failed: AiCheckId[]): AiReadinessResult {
  const ids: AiCheckId[] = ['robots_txt', 'sitemap', 'llms_txt', 'ai_bot_rules'];
  return {
    version: 1,
    status: 'completed',
    scanned_at: '2026-11-06T10:00:00.000Z',
    score,
    level: 1,
    level_name: 'Présence de base',
    max_level: 3,
    site_type: 'vitrine',
    site_type_auto: true,
    site_type_signals: [],
    included_in_global_score: false,
    error: null,
    checks: ids.map((id) => {
      const status: AiCheckStatus = failed.includes(id) ? 'fail' : 'pass';
      return {
        id,
        category: 'discoverability',
        status,
        message: `${id} ${status}`,
        evidence: [{ label: 'GET', url: 'https://ia.fr/robots.txt', status: 200 }],
        specUrls: [],
        weight: 2,
        ...(status === 'fail' ? { fixPrompt: `Corrige ${id}.` } : {}),
      };
    }),
  };
}

describe.skipIf(!hasDatabase)('préparation IA (migration 0007)', () => {
  const t = useTestDb();

  async function completedAudit(url: string, ai: AiReadinessResult | null) {
    const slug = testSlug();
    const id = await t.repos.audits.create({
      slug,
      url,
      source: 'dashboard',
      modules: { ...DEFAULT_AUDIT_MODULES, ai_readiness: ai !== null },
    });
    await t.repos.audits.update(id, {
      status: 'completed',
      global_score: 7,
      global_band: 'good',
      ...(ai !== null ? { ai_readiness: ai, ai_score: ai.score } : {}),
    });
    return { id, slug };
  }

  it('stores the result and exposes it on the public report, never the private columns', async () => {
    const ai = aiResult(60, ['llms_txt']);
    const { id, slug } = await completedAudit('https://ia.fr/', ai);
    expect(PUBLIC_AUDIT_COLUMNS).toContain('ai_readiness');
    const pub = await t.repos.audits.getPublicBySlug(slug, 'full');
    expect(pub?.ai_score).toBe(60);
    expect(pub?.ai_readiness?.checks.map((c) => c.id)).toEqual([
      'robots_txt',
      'sitemap',
      'llms_txt',
      'ai_bot_rules',
    ]);
    expect(pub && 'email' in pub).toBe(false);
    const summary = await t.repos.audits.getPublicBySlug(slug, 'summary');
    expect(summary?.ai_score).toBe(60);
    expect(summary?.ai_readiness).toBeUndefined();
    expect(parseStoredAiReadiness(await t.repos.audits.getAiReadiness(id))).toEqual(ai);
  });

  it('an audit without the module reads as not evaluated (null)', async () => {
    const { slug, id } = await completedAudit('https://sans-ia.fr/', null);
    const pub = await t.repos.audits.getPublicBySlug(slug, 'full');
    expect(pub?.ai_readiness).toBeNull();
    expect(pub?.ai_score).toBeNull();
    expect(await t.repos.audits.getAiReadiness(id)).toBeNull();
  });

  it('rejects out-of-range scores and malformed results at the DB level', async () => {
    const id = await t.repos.audits.create({ slug: testSlug(), url: 'https://x.fr/' });
    await expect(t.repos.audits.update(id, { ai_score: 101 })).rejects.toMatchObject({
      code: '23514',
    });
    await expect(
      t.repos.audits.update(id, { ai_readiness: { version: 1, checks: 'nope' } }),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('dashboard rows carry the AI score and level, "Préparation IA faible" filters < 50', async () => {
    const low = await completedAudit('https://faible.fr/', aiResult(30, ['llms_txt', 'sitemap']));
    const high = await completedAudit('https://forte.fr/', aiResult(90, []));
    const none = await completedAudit('https://aucune.fr/', null);

    const all = await t.repos.dashboard.listAudits({});
    const byId = new Map(all.rows.map((r) => [r.id, r] as const));
    expect(byId.get(low.id)).toMatchObject({
      ai_score: 30,
      ai_level: 1,
      ai_site_type: 'vitrine',
      ai_site_type_auto: true,
      ai_status: 'completed',
    });
    expect(byId.get(high.id)?.ai_score).toBe(90);
    expect(byId.get(none.id)).toMatchObject({ ai_score: null, ai_level: null });

    const filtered = await t.repos.dashboard.listAudits({ aiLow: true });
    expect(filtered.rows.map((r) => r.id)).toEqual([low.id]);
    expect(filtered.total).toBe(1);
  });

  it('analytics: average AI score, low count and most failed tests', async () => {
    await completedAudit('https://a.fr/', aiResult(30, ['llms_txt', 'sitemap']));
    await completedAudit('https://b.fr/', aiResult(70, ['llms_txt']));
    await completedAudit('https://c.fr/', null);
    const now = Date.now();
    const s = await t.repos.analytics.summary({
      from: new Date(now - 86_400_000).toISOString(),
      to: new Date(now + 60_000).toISOString(),
    });
    expect(s.ai_readiness.audits).toBe(2);
    expect(s.ai_readiness.average_score).toBe(50);
    expect(s.ai_readiness.low_count).toBe(1);
    expect(s.ai_readiness.top_failed_checks).toEqual([
      { check_id: 'llms_txt', rule_code: 'ia.llms_txt', label: 'llms.txt', count: 2 },
      { check_id: 'sitemap', rule_code: 'ia.sitemap', label: 'Sitemap', count: 1 },
    ]);
    // The 8-axis average is untouched by the AI module.
    expect(s.average_score).toBe(70);
  });

  it('audit settings persist the AI module defaults and the global score setting', async () => {
    const saved = await t.repos.auditSettings.saveModules({
      ...DEFAULT_AUDIT_MODULES,
      ai_readiness: true,
      site_type: 'contenu',
      ai_in_global_score: true,
    });
    expect(await t.repos.auditSettings.getModules()).toEqual(saved);
    expect(saved).toMatchObject({ ai_readiness: true, site_type: 'contenu' });
  });
});
