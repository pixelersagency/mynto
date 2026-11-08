import { describe, expect, it } from 'vitest';

import { type FindingRowInput } from '../src/index.js';

import { ISO_RE, hasDatabase, testSlug, useTestDb } from './helpers.js';

function finding(
  auditId: string,
  id: string,
  severity: string,
  extra: Partial<FindingRowInput> = {},
): FindingRowInput {
  return {
    id,
    audit_id: auditId,
    rule_code: id.split(':')[0] ?? id,
    axis: 'performance',
    severity,
    effort: 'quick_win',
    title: `Title ${id}`,
    evidence: { n: 1 },
    affected_urls: ['https://example.com/a', 'https://example.com/b'],
    legal_refs: [{ standard: 'WCAG', label: '1.1.1' }],
    narrative_constat: null,
    narrative_impact_business: null,
    narrative_recommandation: null,
    narrative_code_snippet: null,
    ...extra,
  };
}

describe.skipIf(!hasDatabase)('audits repo', () => {
  const t = useTestDb();

  async function completedAudit(email: string | null = 'owner@example.com') {
    const slug = testSlug();
    const id = await t.repos.audits.create({ slug, url: 'https://example.com/', email });
    await t.repos.audits.update(id, {
      status: 'completed',
      scanned_at: new Date().toISOString(),
      stack: 'wordpress',
      stack_confidence: 0.875,
      global_score: 6.25,
      global_band: 'fair',
      axis_scores: { performance: { score: 5.5, band: 'poor', weight: 1 } },
      top3_priorities: [{ title: 'Fix', reason: 'Because' }],
      quick_wins: ['a', 'b'],
      killer_findings: [],
      facts: { url: 'https://example.com/' },
      hero_screenshot_key: `hero/${id}.png`,
      cost_estimate: null,
      llm_input: { homeHtmlExcerpt: '<html>' },
      llm_tokens_in: 12,
    });
    return { id, slug };
  }

  it('public read: parsed shape, numbers, ISO dates, hero URL', async () => {
    const { id, slug } = await completedAudit();
    const audit = await t.repos.audits.getPublicBySlug(slug);
    expect(audit).not.toBeNull();
    expect(audit?.global_score).toBe(6.25);
    expect(audit?.stack_confidence).toBe(0.875);
    expect(audit?.created_at).toMatch(ISO_RE);
    expect(audit?.scanned_at).toMatch(ISO_RE);
    expect(audit?.quick_wins).toEqual(['a', 'b']);
    expect(audit?.top3_priorities).toEqual([{ title: 'Fix', reason: 'Because' }]);
    expect(audit?.axis_scores.performance?.score).toBe(5.5);
    expect(audit?.hero_screenshot_url).toBe(`/media/hero/${id}.png`);
    expect(audit?.cost_estimate).toBeNull();
    const keys = Object.keys(audit ?? {});
    for (const k of ['email', 'llm_input', 'source', 'llm_tokens_in', 'id']) {
      expect(keys).not.toContain(k);
    }
  });

  it('public summary variant has no facts / hero', async () => {
    const { slug } = await completedAudit();
    const audit = await t.repos.audits.getPublicBySlug(slug, 'summary');
    expect(audit?.facts).toBeUndefined();
    expect(audit?.hero_screenshot_url).toBeUndefined();
    expect(audit?.global_band).toBe('fair');
  });

  it('public reads hide expired audits', async () => {
    const slug = testSlug();
    const id = await t.repos.audits.create({
      slug,
      url: 'https://example.com/',
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    await t.repos.audits.upsertFindings([finding(id, 'r:1', 'P1')]);
    expect(await t.repos.audits.getPublicBySlug(slug)).toBeNull();
    expect(await t.repos.audits.getPublicStatusBySlug(slug)).toBeNull();
    expect(await t.repos.audits.listPublicFindingsBySlug(slug)).toBeNull();
    // Internal lookups still see it.
    expect(await t.repos.audits.getIdBySlug(slug)).toBe(id);
  });

  it('missing slug -> null (maybeSingle semantics)', async () => {
    expect(await t.repos.audits.getPublicBySlug('doesnotexist00')).toBeNull();
    expect(await t.repos.audits.getIdBySlug('doesnotexist00')).toBeNull();
    expect(await t.repos.audits.getSourceBySlug('doesnotexist00')).toBeNull();
    expect(await t.repos.audits.getState('3f2b8c1e-9a4d-4c2b-8f1e-0123456789ab')).toBeNull();
  });

  it('upsertFindings: multi-row insert then ON CONFLICT update', async () => {
    const { id, slug } = await completedAudit();
    await t.repos.audits.upsertFindings([
      finding(id, 'perf:2', 'P2'),
      finding(id, 'perf:0', 'P0'),
      finding(id, 'perf:1', 'P1'),
    ]);
    await t.repos.audits.upsertFindings([
      finding(id, 'perf:0', 'P0', { narrative_constat: 'Constat', affected_urls: [] }),
    ]);
    const list = await t.repos.audits.listPublicFindingsBySlug(slug);
    expect(list?.map((f) => f.id)).toEqual(['perf:0', 'perf:1', 'perf:2']);
    expect(list?.[0]?.narrative_constat).toBe('Constat');
    expect(list?.[0]?.affected_urls).toEqual([]);
    expect(list?.[1]?.affected_urls).toEqual(['https://example.com/a', 'https://example.com/b']);
    expect(list?.[1]?.legal_refs).toEqual([{ standard: 'WCAG', label: '1.1.1' }]);
    expect(list?.[0]?.created_at).toMatch(ISO_RE);
    const rebuild = await t.repos.audits.listFindingsForRebuild(id);
    expect(rebuild).toHaveLength(3);
    expect(rebuild[0]).not.toHaveProperty('narrative_constat');
  });

  it('claimInterpretation: exactly one concurrent winner', async () => {
    const id = await t.repos.audits.create({
      slug: testSlug(),
      url: 'https://example.com/',
      source: 'radar',
      llmStatus: 'deferred',
    });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => t.repos.audits.claimInterpretation(id)),
    );
    const winners = results.filter((r) => r !== null);
    expect(winners).toHaveLength(1);
    expect(winners[0]).toEqual({ status: 'queued', llm_status: 'pending', source: 'radar' });
    expect(await t.repos.audits.claimInterpretation(id)).toBeNull();
  });

  it('updateIfLlmStatus is conditional', async () => {
    const id = await t.repos.audits.create({
      slug: testSlug(),
      url: 'https://example.com/',
      source: 'radar',
      llmStatus: 'deferred',
    });
    expect(await t.repos.audits.updateIfLlmStatus(id, 'pending', { llm_status: 'done' })).toBe(0);
    await t.repos.audits.claimInterpretation(id);
    expect(
      await t.repos.audits.updateIfLlmStatus(id, 'pending', {
        llm_status: 'done',
        interpreted_at: new Date().toISOString(),
      }),
    ).toBe(1);
    const state = await t.repos.audits.getState(id);
    expect(state?.llm_status).toBe('done');
    const interp = await t.repos.audits.getForInterpret(id);
    expect(interp?.axis_scores).toEqual({});
  });

  it('purgeExpired deletes past the grace day and cascades', async () => {
    const old = await t.repos.audits.create({
      slug: testSlug(),
      url: 'https://example.com/',
      expiresAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    await t.repos.audits.update(old, { hero_screenshot_key: `hero/${old}.png` });
    const recent = await t.repos.audits.create({
      slug: testSlug(),
      url: 'https://example.com/',
      expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    await t.repos.audits.upsertFindings([finding(old, 'x:1', 'P3')]);
    await t.repos.views.insert({ auditId: old, userAgentFamily: null, ipHash: null });
    await t.repos.radar.insertLink({
      auditId: old,
      externalRef: 'ext-old',
      domain: 'example.com',
      trackingToken: 'a'.repeat(32),
      reused: false,
    });

    const purged = await t.repos.audits.purgeExpired();
    expect(purged).toEqual([
      { id: old, hero_screenshot_key: `hero/${old}.png`, favicon_key: null },
    ]);
    const counts = await t.sql<{ f: number; v: number; r: number; a: number }[]>`
      select (select count(*)::int from audit_findings_full) f,
             (select count(*)::int from audit_views) v,
             (select count(*)::int from radar_audits) r,
             (select count(*)::int from audits_full) a
    `;
    expect(counts[0]).toEqual({ f: 0, v: 0, r: 0, a: 1 });
    expect(await t.repos.audits.getIdBySlug('nope0000000')).toBeNull();
    expect(recent).toBeTruthy();
  });

  it('views: insert and dedupe window', async () => {
    const { id } = await completedAudit();
    const since = new Date(Date.now() - 30 * 60_000).toISOString();
    expect(await t.repos.views.hasRecentView(id, 'h1', since)).toBe(false);
    await t.repos.views.insert({ auditId: id, userAgentFamily: 'Chrome, mobile', ipHash: 'h1' });
    expect(await t.repos.views.hasRecentView(id, 'h1', since)).toBe(true);
    expect(await t.repos.views.hasRecentView(id, 'h2', since)).toBe(false);
    expect(
      await t.repos.views.hasRecentView(id, 'h1', new Date(Date.now() + 60_000).toISOString()),
    ).toBe(false);
  });
});
