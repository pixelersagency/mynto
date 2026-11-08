import { describe, expect, it } from 'vitest';

import { hasDatabase, testSlug, useTestDb } from './helpers.js';

const tok = (c: string): string => c.repeat(32);

describe.skipIf(!hasDatabase)('dashboard repo', () => {
  const t = useTestDb();

  async function dashAudit(
    url: string,
    token: string,
    extra: { label?: string; createdAt?: string } = {},
  ) {
    const res = await t.repos.dashboard.createAuditWithLink(
      { slug: testSlug(), url, label: extra.label ?? null },
      { domain: new URL(url).host, trackingToken: token },
    );
    if (extra.createdAt) {
      await t.sql`update audits_full set created_at = ${extra.createdAt} where id = ${res.auditId}`;
    }
    return res;
  }

  it('createAuditWithLink: dashboard source, dashboard link without external_ref', async () => {
    const res = await dashAudit('https://acme.fr/', tok('a'), { label: 'Acme' });
    const [a] = await t.sql<{ source: string; label: string; status: string }[]>`
      select source, label, status from audits_full where id = ${res.auditId}
    `;
    expect(a).toEqual({ source: 'dashboard', label: 'Acme', status: 'queued' });
    const [l] = await t.sql<{ origin: string; external_ref: string | null }[]>`
      select origin, external_ref from radar_audits where id = ${res.linkId}
    `;
    expect(l).toEqual({ origin: 'dashboard', external_ref: null });
    expect(res.trackingToken).toBe(tok('a'));
  });

  it('a radar link still requires an external_ref', async () => {
    const res = await dashAudit('https://acme.fr/', tok('a'));
    await expect(
      t.sql`insert into radar_audits (audit_id, domain, tracking_token, origin)
            values (${res.auditId}, 'acme.fr', ${tok('b')}, 'radar')`,
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('listAudits: filters, search, sort, pagination, views and pages', async () => {
    const a = await dashAudit('https://alpha.fr/', tok('a'), {
      label: 'Client 50%',
      createdAt: '2026-10-05T10:00:00.000Z',
    });
    const b = await dashAudit('https://beta.fr/', tok('b'), {
      createdAt: '2026-11-02T10:00:00.000Z',
    });
    const c = await dashAudit('https://gamma.fr/', tok('c'), {
      createdAt: '2026-11-03T10:00:00.000Z',
    });
    await t.repos.audits.update(a.auditId, {
      status: 'completed',
      global_score: 7.2,
      facts: { internalPagesCrawled: ['https://alpha.fr/a', 'https://alpha.fr/b'] },
    });
    await t.repos.audits.update(b.auditId, { status: 'failed' });
    await t.sql`update audits_full set expires_at = now() - interval '1 day' where id = ${c.auditId}`;
    await t.repos.radar.recordView({
      radarAuditId: a.linkId,
      ipHash: 'ip',
      userAgent: null,
      viewedAt: new Date().toISOString(),
      dedupeWindowMs: 1000,
    });

    const all = await t.repos.dashboard.listAudits({});
    expect(all.total).toBe(3);
    expect(all.rows.map((r) => r.url)).toEqual([
      'https://gamma.fr/',
      'https://beta.fr/',
      'https://alpha.fr/',
    ]);
    const alpha = all.rows.find((r) => r.id === a.auditId);
    expect(alpha).toMatchObject({
      pages: 3,
      views_count: 1,
      tracking_token: tok('a'),
      global_score: 7.2,
      label: 'Client 50%',
    });
    expect(all.rows.find((r) => r.id === b.auditId)?.pages).toBeNull();

    expect((await t.repos.dashboard.listAudits({ status: 'failed' })).rows).toHaveLength(1);
    expect((await t.repos.dashboard.listAudits({ status: 'expired' })).rows[0]?.id).toBe(c.auditId);
    expect((await t.repos.dashboard.listAudits({ status: 'completed' })).total).toBe(1);
    // LIKE wildcards are escaped: "50%" matches literally.
    expect((await t.repos.dashboard.listAudits({ q: '50%' })).total).toBe(1);
    expect((await t.repos.dashboard.listAudits({ q: '_' })).total).toBe(0);
    expect((await t.repos.dashboard.listAudits({ q: 'BETA' })).total).toBe(1);
    const nov = await t.repos.dashboard.listAudits({
      createdFrom: '2026-11-01T00:00:00.000Z',
      createdTo: '2026-12-01T00:00:00.000Z',
    });
    expect(nov.total).toBe(2);
    const page2 = await t.repos.dashboard.listAudits({ limit: 2, offset: 2 });
    expect(page2.rows).toHaveLength(1);
    expect(page2.total).toBe(3);
    const byScore = await t.repos.dashboard.listAudits({ sort: 'score_desc' });
    expect(byScore.rows[0]?.id).toBe(a.auditId);

    const counts = await t.repos.dashboard.counts('2026-11-01T00:00:00.000Z');
    expect(counts).toMatchObject({ all: 3, failed: 1, in_progress: 0, this_month: 2, links: 2 });
  });

  it('refreshAudit keeps the link, hides the old scan; a second refresh is in_progress', async () => {
    const a = await dashAudit('https://alpha.fr/', tok('a'), { label: 'Alpha' });
    const res = await t.repos.dashboard.refreshAudit(a.auditId, {
      slug: testSlug(),
      url: 'https://alpha.fr/',
      source: 'dashboard',
      label: 'Alpha',
    });
    expect(res.kind).toBe('ok');
    if (res.kind !== 'ok') return;
    const again = await t.repos.dashboard.refreshAudit(a.auditId, {
      slug: testSlug(),
      url: 'https://alpha.fr/',
    });
    expect(again).toEqual({ kind: 'in_progress' });

    const list = await t.repos.dashboard.listAudits({});
    expect(list.rows.map((r) => r.id)).toEqual([res.newAuditId]);
    expect(list.rows[0]?.tracking_token).toBe(tok('a'));
    expect((await t.repos.radar.findByToken(tok('a')))?.audit_id).toBe(res.newAuditId);
  });

  it('deleteAudit removes the chain of replaced scans and returns hero keys', async () => {
    const a = await dashAudit('https://alpha.fr/', tok('a'));
    await t.repos.audits.update(a.auditId, { hero_screenshot_key: `hero/${a.auditId}.png` });
    const res = await t.repos.dashboard.refreshAudit(a.auditId, {
      slug: testSlug(),
      url: 'https://alpha.fr/',
    });
    if (res.kind !== 'ok') throw new Error('refresh failed');
    const other = await dashAudit('https://other.fr/', tok('o'));

    const deleted = await t.repos.dashboard.deleteAudit(res.newAuditId);
    expect(deleted.map((d) => d.id).sort()).toEqual([a.auditId, res.newAuditId].sort());
    expect(deleted.find((d) => d.id === a.auditId)?.hero_screenshot_key).toBe(
      `hero/${a.auditId}.png`,
    );
    expect(await t.repos.radar.findByToken(tok('a'))).toBeNull();
    expect((await t.repos.dashboard.listAudits({})).rows.map((r) => r.id)).toEqual([other.auditId]);
  });

  it('listLinks and statuses', async () => {
    const a = await dashAudit('https://alpha.fr/', tok('a'));
    const links = await t.repos.dashboard.listLinks();
    expect(links.total).toBe(1);
    expect(links.rows[0]).toMatchObject({
      origin: 'dashboard',
      domain: 'alpha.fr',
      views_count: 0,
    });
    expect(await t.repos.dashboard.statuses([a.auditId])).toEqual([
      { id: a.auditId, status: 'queued' },
    ]);
    expect(await t.repos.dashboard.statuses([])).toEqual([]);
  });
});

describe.skipIf(!hasDatabase)('settings repo', () => {
  const t = useTestDb();
  const defaults = {
    name: 'Agence Démo',
    website_url: null,
    contact_url: null,
    primary_color: null,
    report_footer: null,
    daily_rate_eur: null,
  };

  it('get is null before the first save; save upserts a single row', async () => {
    expect(await t.repos.settings.get()).toBeNull();
    await t.repos.settings.save({ ...defaults, primary_color: '#2563EB' });
    const saved = await t.repos.settings.save({ ...defaults, name: 'Nouveau nom' });
    expect(saved).toMatchObject({ name: 'Nouveau nom', primary_color: null });
    const [n] = await t.sql<{ n: number }[]>`select count(*)::int n from agency_settings`;
    expect(n?.n).toBe(1);
  });

  it('setLogoKey creates the row if needed and returns the previous key', async () => {
    expect(await t.repos.settings.setLogoKey('brand/logo-abcdefgh.png', defaults)).toEqual({
      previous: null,
    });
    expect(await t.repos.settings.setLogoKey('brand/logo-ijklmnop.jpg', defaults)).toEqual({
      previous: 'brand/logo-abcdefgh.png',
    });
    expect((await t.repos.settings.get())?.logo_key).toBe('brand/logo-ijklmnop.jpg');
    await expect(t.repos.settings.setLogoKey('../etc/passwd', defaults)).rejects.toThrow();
  });

  it('setFaviconKey is independent of the logo and keeps the other fields', async () => {
    await t.repos.settings.setLogoKey('brand/logo-abcdefgh.png', defaults);
    expect(await t.repos.settings.setFaviconKey('brand/favicon-abcdefgh.svg', defaults)).toEqual({
      previous: null,
    });
    expect(await t.repos.settings.setFaviconKey('brand/favicon-ijklmnop.ico', defaults)).toEqual({
      previous: 'brand/favicon-abcdefgh.svg',
    });
    await t.repos.settings.save({ ...defaults, name: 'Renommée' });
    expect(await t.repos.settings.get()).toMatchObject({
      name: 'Renommée',
      logo_key: 'brand/logo-abcdefgh.png',
      favicon_key: 'brand/favicon-ijklmnop.ico',
    });
    expect(await t.repos.settings.setFaviconKey(null, defaults)).toEqual({
      previous: 'brand/favicon-ijklmnop.ico',
    });
    expect((await t.repos.settings.get())?.logo_key).toBe('brand/logo-abcdefgh.png');
    await expect(
      t.repos.settings.setFaviconKey('brand/logo-abcdefgh.png', defaults),
    ).rejects.toThrow();
    await expect(
      t.repos.settings.setFaviconKey('brand/favicon-abcdefgh.html', defaults),
    ).rejects.toThrow();
  });

  it('setFaviconKey creates the row when nothing was saved yet', async () => {
    await t.repos.settings.setFaviconKey('brand/favicon-qrstuvwx.png', defaults);
    expect(await t.repos.settings.get()).toMatchObject({
      name: 'Agence Démo',
      logo_key: null,
      favicon_key: 'brand/favicon-qrstuvwx.png',
    });
  });

  it('the database rejects invalid values even without the app validation', async () => {
    await expect(
      t.sql`insert into agency_settings (name, primary_color) values ('x', 'red')`,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      t.sql`insert into agency_settings (name, contact_url) values ('x', 'javascript:alert(1)')`,
    ).rejects.toMatchObject({ code: '23514' });
    await t.sql`insert into agency_settings (name) values ('x')`;
    await expect(
      t.sql`insert into agency_settings (id, name) values (false, 'y')`,
    ).rejects.toMatchObject({ code: '23514' });
  });
});
