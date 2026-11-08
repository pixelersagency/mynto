import { describe, expect, it } from 'vitest';

import { isUniqueViolation } from '../src/index.js';

import { ISO_RE, hasDatabase, testSlug, useTestDb } from './helpers.js';

const tok = (c: string): string => c.repeat(32);

describe.skipIf(!hasDatabase)('radar repo', () => {
  const t = useTestDb();

  function newScan(ref: string, token: string, domain = 'example.com') {
    return t.repos.radar.createScanWithLink(
      {
        slug: testSlug(),
        url: `https://${domain}/`,
        source: 'radar',
        llmStatus: 'deferred',
        expiresAt: new Date(Date.now() + 180 * 86_400_000).toISOString(),
      },
      { externalRef: ref, domain, trackingToken: token, reused: false },
    );
  }

  it('createScanWithLink returns the joined shape', async () => {
    const link = await newScan('ref-1', tok('a'));
    expect(link.reused).toBe(false);
    expect(link.tracking_token).toBe(tok('a'));
    expect(link.audits_full.status).toBe('queued');
    expect(link.audits_full.created_at).toMatch(ISO_RE);
    const found = await t.repos.radar.findByExternalRef('ref-1');
    expect(found).toEqual(link);
    expect(await t.repos.radar.findByExternalRef('nope')).toBeNull();
    const state = await t.repos.audits.getState(link.audit_id);
    expect(state).toEqual({ status: 'queued', llm_status: 'deferred', source: 'radar' });
  });

  it('duplicate external_ref: 23505 and no orphan scan (transaction)', async () => {
    await newScan('ref-dup', tok('a'));
    const err = await newScan('ref-dup', tok('b')).catch((e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
    const [c] = await t.sql<{ n: number }[]>`select count(*)::int n from audits_full`;
    expect(c?.n).toBe(1);
  });

  it('insertLink on a cached scan; duplicate ref -> 23505', async () => {
    const first = await newScan('ref-a', tok('a'));
    const reused = await t.repos.radar.insertLink({
      auditId: first.audit_id,
      externalRef: 'ref-b',
      domain: 'example.com',
      trackingToken: tok('b'),
      reused: true,
    });
    expect(reused.audit_id).toBe(first.audit_id);
    expect(reused.reused).toBe(true);
    const err = await t.repos.radar
      .insertLink({
        auditId: first.audit_id,
        externalRef: 'ref-b',
        domain: 'example.com',
        trackingToken: tok('c'),
        reused: true,
      })
      .catch((e: unknown) => e);
    expect(isUniqueViolation(err)).toBe(true);
  });

  it('listDomainCandidates: newest first, max 20, domain only', async () => {
    for (let i = 0; i < 22; i += 1) {
      await newScan(`ref-${String(i)}`, `${String(i).padStart(2, '0')}${'x'.repeat(30)}`);
    }
    await newScan('other', tok('o'), 'other.org');
    const rows = await t.repos.radar.listDomainCandidates('example.com');
    expect(rows).toHaveLength(20);
    const last = await t.repos.radar.findByExternalRef('ref-21');
    expect(rows[0]?.audit_id).toBe(last?.audit_id);
    expect(rows[0]?.audits_full.expires_at).toMatch(ISO_RE);
  });

  it('getDetail / getAuditRef / getForRefresh / findByToken', async () => {
    const link = await newScan('ref-1', tok('a'));
    await t.repos.audits.update(link.audit_id, {
      status: 'completed',
      global_score: 7.5,
      axis_scores: { ux: { score: 7.5, band: 'good', weight: 1 } },
    });
    const detail = await t.repos.radar.getDetail(link.id);
    expect(detail?.audits_full).toEqual({
      status: 'completed',
      global_score: 7.5,
      axis_scores: { ux: { score: 7.5, band: 'good', weight: 1 } },
      llm_status: 'deferred',
    });
    expect(await t.repos.radar.getAuditRef(link.id)).toEqual({
      id: link.id,
      audit_id: link.audit_id,
    });
    const refresh = await t.repos.radar.getForRefresh(link.id);
    expect(refresh?.audits_full.url).toBe('https://example.com/');
    const byToken = await t.repos.radar.findByToken(tok('a'));
    expect(byToken?.id).toBe(link.id);
    expect(byToken?.audits_full.slug).toMatch(/^[A-Za-z0-9_-]{10,20}$/);
    expect(await t.repos.radar.findByToken(tok('z'))).toBeNull();
    expect(await t.repos.radar.getDetail('3f2b8c1e-9a4d-4c2b-8f1e-0123456789ab')).toBeNull();
  });

  it('refreshScan repoints every row; a second refresh is in_progress; undo restores', async () => {
    const first = await newScan('ref-1', tok('a'));
    await t.repos.radar.insertLink({
      auditId: first.audit_id,
      externalRef: 'ref-2',
      domain: 'example.com',
      trackingToken: tok('b'),
      reused: true,
    });
    const input = {
      slug: testSlug(),
      url: 'https://example.com/',
      source: 'radar' as const,
      llmStatus: 'pending' as const,
    };
    const res = await t.repos.radar.refreshScan(first.audit_id, input);
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    expect(res.rowsRepointed).toBe(2);

    const again = await t.repos.radar.refreshScan(first.audit_id, { ...input, slug: testSlug() });
    expect(again).toEqual({ kind: 'in_progress' });
    const [c] = await t.sql<{ n: number }[]>`select count(*)::int n from audits_full`;
    expect(c?.n).toBe(2); // rolled back insert left nothing behind

    await t.repos.radar.undoRefresh(first.audit_id, res.newAuditId);
    expect((await t.repos.radar.findByExternalRef('ref-2'))?.audit_id).toBe(first.audit_id);
    expect(await t.repos.audits.getState(res.newAuditId)).toBeNull();
  });

  it('views: record bumps the counter, dedupes per (link, ip_hash) in the window', async () => {
    const link = await newScan('ref-1', tok('a'));
    const window = 30 * 60_000;
    const t1 = new Date(Date.now() - 60_000).toISOString();
    const base = { radarAuditId: link.id, userAgent: 'Chrome, ordinateur', dedupeWindowMs: window };

    expect(await t.repos.radar.recordView({ ...base, ipHash: 'ip-1', viewedAt: t1 })).toBe(
      'recorded',
    );
    // Same visitor 1 minute later: deduped.
    expect(
      await t.repos.radar.recordView({
        ...base,
        ipHash: 'ip-1',
        viewedAt: new Date().toISOString(),
      }),
    ).toBe('deduped');
    // Other visitor: counted.
    expect(
      await t.repos.radar.recordView({
        ...base,
        ipHash: 'ip-2',
        viewedAt: new Date().toISOString(),
      }),
    ).toBe('recorded');
    // Same visitor after the window: counted again.
    const later = new Date(Date.now() + window + 60_000).toISOString();
    expect(await t.repos.radar.recordView({ ...base, ipHash: 'ip-1', viewedAt: later })).toBe(
      'recorded',
    );

    const [row] = await t.sql<{ views_count: number; last_viewed_at: string }[]>`
      select views_count, last_viewed_at from radar_audits where id = ${link.id}
    `;
    expect(row?.views_count).toBe(3);
    expect(row?.last_viewed_at).toBe(later);

    const views = await t.sql<
      { duration_s: number; sections_viewed: unknown; session_hash: string | null }[]
    >`
      select duration_s, sections_viewed, session_hash from radar_audit_views
    `;
    expect(views.every((v) => v.duration_s === 0 && v.session_hash === null)).toBe(true);
  });

  it('views: concurrent beacons of one visitor count once', async () => {
    const link = await newScan('ref-1', tok('a'));
    const now = new Date().toISOString();
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        t.repos.radar.recordView({
          radarAuditId: link.id,
          ipHash: 'same-ip',
          userAgent: null,
          viewedAt: now,
          dedupeWindowMs: 30 * 60_000,
        }),
      ),
    );
    expect(results.filter((r) => r === 'recorded')).toHaveLength(1);
  });

  it('refreshScan marks the old scan as replaced', async () => {
    const first = await newScan('ref-1', tok('a'));
    const res = await t.repos.radar.refreshScan(first.audit_id, {
      slug: testSlug(),
      url: 'https://example.com/',
      source: 'radar',
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const [old] = await t.sql<{ replaced_by: string | null }[]>`
      select replaced_by from audits_full where id = ${first.audit_id}
    `;
    expect(old?.replaced_by).toBe(res.newAuditId);
    await t.repos.radar.undoRefresh(first.audit_id, res.newAuditId);
    const [back] = await t.sql<{ replaced_by: string | null }[]>`
      select replaced_by from audits_full where id = ${first.audit_id}
    `;
    expect(back?.replaced_by).toBeNull();
  });

  it('findings summaries', async () => {
    const link = await newScan('ref-1', tok('a'));
    await t.repos.audits.upsertFindings([
      {
        id: 'r:1',
        audit_id: link.audit_id,
        rule_code: 'r',
        axis: 'ux',
        severity: 'P1',
        effort: null,
        title: 'T',
        evidence: {},
        affected_urls: [],
        legal_refs: [],
        narrative_constat: null,
        narrative_impact_business: null,
        narrative_recommandation: null,
        narrative_code_snippet: null,
      },
    ]);
    expect(await t.repos.radar.listFindingSummaries(link.audit_id)).toEqual([
      { axis: 'ux', severity: 'P1', title: 'T' },
    ]);
  });
});
