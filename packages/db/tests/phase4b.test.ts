import { randomBytes } from 'node:crypto';

import { DEFAULT_AUDIT_MODULES, type AuditModules } from '@mynto/shared';
import { describe, expect, it } from 'vitest';

import { resolveAiConfig } from '../src/ai-config.js';
import { encryptSecret, maskSecret } from '../src/secrets.js';

import { hasDatabase, testSlug, useTestDb } from './helpers.js';

const MASTER = randomBytes(32).toString('base64');
const tok = (c: string): string => c.repeat(32);

describe.skipIf(!hasDatabase)('phase 4b repos', () => {
  const t = useTestDb();

  async function dashAudit(url: string, token: string, modules?: AuditModules) {
    return t.repos.dashboard.createAuditWithLink(
      { slug: testSlug(), url, modules: modules ?? null },
      { domain: new URL(url).host, trackingToken: token },
    );
  }

  describe('modules', () => {
    it('audit settings default to every module, then persist', async () => {
      expect(await t.repos.auditSettings.getModules()).toEqual(DEFAULT_AUDIT_MODULES);
      const saved = await t.repos.auditSettings.saveModules({
        axes: ['ui', 'seo_technique'],
        lighthouse: false,
        vision: true,
        hero: false,
        narrative: true,
        ai_readiness: false,
        site_type: 'auto',
        ai_in_global_score: false,
      });
      // Canonical order.
      expect(saved.axes).toEqual(['seo_technique', 'ui']);
      expect(await t.repos.auditSettings.getModules()).toEqual(saved);
      await expect(t.repos.auditSettings.saveModules({ ...saved, axes: [] })).rejects.toBeDefined();
    });

    it('stores the resolved modules on the audit, public read exposes them', async () => {
      const modules: AuditModules = {
        axes: ['seo_technique', 'performance'],
        lighthouse: true,
        vision: false,
        hero: false,
        narrative: false,
        ai_readiness: false,
        site_type: 'auto',
        ai_in_global_score: false,
      };
      const a = await dashAudit('https://modules.fr/', tok('m'), modules);
      expect(await t.repos.audits.getModules(a.auditId)).toEqual(modules);
      const [row] = await t.sql<
        { slug: string }[]
      >`select slug from audits_full where id = ${a.auditId}`;
      const pub = await t.repos.audits.getPublicBySlug(row?.slug ?? '', 'full');
      expect(pub?.modules).toEqual(modules);
      const { rows } = await t.repos.dashboard.listAudits({ ids: [a.auditId] });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.modules).toEqual(modules);
    });

    it('rejects a malformed modules value at the DB level', async () => {
      await expect(
        t.sql`insert into audits_full (slug, url, modules)
              values (${testSlug()}, 'https://x.fr/', ${t.sql.json({ axes: [] })})`,
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('accepts api and mcp sources', async () => {
      for (const source of ['api', 'mcp'] as const) {
        const id = await t.repos.audits.create({ slug: testSlug(), url: 'https://s.fr/', source });
        expect((await t.repos.audits.getState(id))?.source).toBe(source);
      }
    });

    it('currentId follows the refresh chain', async () => {
      const a = await dashAudit('https://chain.fr/', tok('c'));
      await t.repos.audits.update(a.auditId, { status: 'completed' });
      const r = await t.repos.dashboard.refreshAudit(a.auditId, {
        slug: testSlug(),
        url: 'https://chain.fr/',
        source: 'dashboard',
      });
      expect(r.kind).toBe('ok');
      const newId = r.kind === 'ok' ? r.newAuditId : '';
      expect(await t.repos.dashboard.currentId(a.auditId)).toBe(newId);
      expect(await t.repos.dashboard.currentId(newId)).toBe(newId);
      expect(await t.repos.dashboard.currentId('00000000-0000-4000-8000-000000000000')).toBeNull();
    });
  });

  describe('ai settings and keys', () => {
    it('falls back to env when nothing is stored', async () => {
      const cfg = await resolveAiConfig(t.repos.ai, {
        APP_ENCRYPTION_KEY: MASTER,
        ANTHROPIC_API_KEY: 'sk-ant-from-env-000000',
      });
      expect(cfg.narrative).toMatchObject({
        provider: 'anthropic',
        model: 'claude-haiku-5-5',
        apiKey: 'sk-ant-from-env-000000',
        keySource: 'env',
      });
      expect(cfg.vision).toMatchObject({ provider: 'anthropic', model: 'claude-haiku-5-5' });
    });

    it('stored settings and encrypted keys win over env, list never leaks', async () => {
      await t.repos.ai.saveSettings({
        narrative_provider: 'gemini',
        vision_provider: 'gemini',
        models: { gemini: { narrative: 'gemini-x-pro', vision: '' } },
      });
      const secret = 'AIzaSy-stored-key-123456789';
      await t.repos.ai.setKey(
        'gemini',
        encryptSecret(secret, MASTER, 'gemini'),
        maskSecret(secret),
      );

      const listed = await t.repos.ai.listKeys();
      expect(listed).toEqual([
        expect.objectContaining({ provider: 'gemini', key_hint: 'AIz…6789' }),
      ]);
      expect(JSON.stringify(listed)).not.toContain('stored-key');
      const [raw] = await t.sql<{ ciphertext: string }[]>`select ciphertext from ai_provider_keys`;
      expect(raw?.ciphertext).not.toContain('stored-key');

      const cfg = await resolveAiConfig(t.repos.ai, {
        APP_ENCRYPTION_KEY: MASTER,
        GEMINI_API_KEY: 'env-gemini-key-000',
        AUDIT_LLM_MODEL: 'ignored-for-other-provider',
      });
      expect(cfg.narrative).toMatchObject({
        provider: 'gemini',
        model: 'gemini-x-pro',
        apiKey: secret,
        keySource: 'dashboard',
      });
      expect(cfg.vision).toMatchObject({ provider: 'gemini', model: 'gemini-2.5-flash' });

      // Wrong master key: reported, env fallback used.
      const bad = await resolveAiConfig(t.repos.ai, {
        APP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        GEMINI_API_KEY: 'env-gemini-key-000',
      });
      expect(bad.undecryptable).toEqual(['gemini']);
      expect(bad.narrative.keySource).toBe('env');

      expect(await t.repos.ai.deleteKey('gemini')).toBe(true);
      expect(await t.repos.ai.listKeys()).toEqual([]);
    });

    it('rejects invalid model ids and providers', async () => {
      await expect(
        t.repos.ai.saveSettings({
          narrative_provider: 'anthropic',
          vision_provider: 'anthropic',
          models: { anthropic: { narrative: 'bad model; drop' } },
        }),
      ).rejects.toBeDefined();
      await expect(
        t.sql`insert into ai_settings (narrative_provider) values ('openai')`,
      ).rejects.toMatchObject({ code: '23514' });
    });
  });

  describe('api keys', () => {
    it('creates once, stores only hash + prefix, verifies and revokes', async () => {
      const created = await t.repos.apiKeys.create('Zapier');
      expect(created.secret).toMatch(/^myn_live_[A-Za-z0-9_-]{43}$/);
      expect(created.prefix).toBe(created.secret.slice(0, 17));
      const [row] = await t.sql<{ key_hash: string; prefix: string }[]>`
        select key_hash, prefix from api_keys where id = ${created.id}
      `;
      expect(row?.key_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(row)).not.toContain(created.secret);

      const list = await t.repos.apiKeys.list();
      expect(list).toHaveLength(1);
      expect(JSON.stringify(list)).not.toContain(created.secret);
      expect(list[0]?.last_used_at).toBeNull();

      expect(await t.repos.apiKeys.verify(created.secret)).toEqual({
        id: created.id,
        name: 'Zapier',
      });
      expect((await t.repos.apiKeys.list())[0]?.last_used_at).not.toBeNull();
      expect(await t.repos.apiKeys.verify(`${created.secret.slice(0, -1)}x`)).toBeNull();
      expect(await t.repos.apiKeys.verify('myn_live_short')).toBeNull();
      expect(await t.repos.apiKeys.verify('')).toBeNull();

      expect(await t.repos.apiKeys.revoke(created.id)).toBe(true);
      expect(await t.repos.apiKeys.revoke(created.id)).toBe(false);
      expect(await t.repos.apiKeys.verify(created.secret)).toBeNull();
    });
  });

  describe('analytics', () => {
    it('aggregates over the period, ignoring disabled axes', async () => {
      const from = '2026-10-01T00:00:00.000Z';
      const to = '2026-11-01T00:00:00.000Z';
      const mk = async (
        url: string,
        token: string,
        at: string,
        patch: Parameters<typeof t.repos.audits.update>[1],
      ) => {
        const a = await dashAudit(url, token);
        await t.sql`update audits_full set created_at = ${at} where id = ${a.auditId}`;
        await t.sql`update radar_audits set created_at = ${at} where id = ${a.linkId}`;
        await t.repos.audits.update(a.auditId, patch);
        return a;
      };
      const a = await mk('https://a.fr/', tok('a'), '2026-10-06T10:00:00.000Z', {
        status: 'completed',
        global_score: 8,
        axis_scores: { seo_technique: { score: 8, band: 'good' }, ui: { score: 6, band: 'fair' } },
        llm_provider: 'anthropic',
        llm_tokens_in: 1000,
        llm_tokens_out: 200,
        facts: { vision: { fetched: true } },
      });
      await mk('https://b.fr/', tok('b'), '2026-10-20T10:00:00.000Z', {
        status: 'completed',
        global_score: 4,
        // ui disabled for this audit: absent, not 0.
        axis_scores: { seo_technique: { score: 4, band: 'poor' } },
      });
      await mk('https://c.fr/', tok('c'), '2026-10-21T10:00:00.000Z', { status: 'failed' });
      // Outside the period.
      await mk('https://d.fr/', tok('d'), '2026-11-03T10:00:00.000Z', { status: 'completed' });

      await t.repos.audits.upsertFindings(
        ['a', 'b'].map((k) => ({
          id: `seo.meta.missing:${k}`,
          audit_id: a.auditId,
          rule_code: 'seo.meta.missing',
          axis: 'seo_technique',
          severity: 'P1',
          effort: null,
          title: 'Meta description absente',
          evidence: {},
          affected_urls: [],
          legal_refs: [],
          narrative_constat: null,
          narrative_impact_business: null,
          narrative_recommandation: null,
          narrative_code_snippet: null,
        })),
      );

      // First opening 2 h after the link was created.
      const [link] = await t.sql<{ id: string }[]>`
        select id from radar_audits where audit_id = ${a.auditId}
      `;
      await t.sql`
        insert into radar_audit_views (radar_audit_id, viewed_at)
        values (${link?.id ?? ''}, '2026-10-06T12:00:00.000Z')
      `;
      await t.sql`update radar_audits set views_count = 1 where id = ${link?.id ?? ''}`;

      const s = await t.repos.analytics.summary({ from, to });
      expect(s.audits).toEqual({ total: 3, completed: 2, failed: 1, in_progress: 0 });
      expect(s.average_score).toBe(60);
      const axis = Object.fromEntries(s.axes.map((x) => [x.axis, x]));
      expect(axis.seo_technique).toEqual({ axis: 'seo_technique', average: 60, audits: 2 });
      expect(axis.ui).toEqual({ axis: 'ui', average: 60, audits: 1 });
      expect(axis.performance).toEqual({ axis: 'performance', average: null, audits: 0 });
      expect(s.score_bands).toEqual([
        { band: 'good', count: 1 },
        { band: 'fair', count: 0 },
        { band: 'poor', count: 1 },
      ]);
      expect(s.links).toEqual({
        total: 3,
        opened: 1,
        open_rate: 0.333,
        median_hours_to_first_open: 2,
      });
      expect(s.sources).toEqual([{ source: 'dashboard', count: 3 }]);
      expect(s.top_findings).toEqual([
        {
          rule_code: 'seo.meta.missing',
          axis: 'seo_technique',
          count: 1,
          label: 'Meta description absente',
        },
      ]);
      expect(s.llm).toEqual({ calls: 1, tokens_in: 1000, tokens_out: 200, vision_calls: 1 });
      expect(s.weekly.length).toBeGreaterThanOrEqual(5);
      expect(s.weekly.reduce((n, w) => n + w.completed + w.failed + w.in_progress, 0)).toBe(3);
      expect(s.weekly.find((w) => w.week_start === '2026-10-05')).toEqual({
        week_start: '2026-10-05',
        completed: 1,
        failed: 0,
        in_progress: 0,
      });

      const feed = await t.repos.analytics.activity(10);
      // d.fr (newest): finished at its creation instant, listed before "created".
      expect(feed.slice(0, 2).map((e) => e.kind)).toEqual(['completed', 'created']);
      expect(feed.map((e) => e.kind)).toContain('opened');
      expect(feed.map((e) => e.kind)).toContain('failed');
    });

    it('empty period', async () => {
      const s = await t.repos.analytics.summary({
        from: '2020-01-01T00:00:00.000Z',
        to: '2020-01-08T00:00:00.000Z',
      });
      expect(s.audits.total).toBe(0);
      expect(s.average_score).toBeNull();
      expect(s.links.open_rate).toBeNull();
      expect(s.period_days).toBe(7);
    });
  });

  describe('audit_views (CNIL-simplified)', () => {
    it('has no country column and caps the UA family', async () => {
      const cols = await t.sql<{ column_name: string }[]>`
        select column_name from information_schema.columns where table_name = 'audit_views'
      `;
      expect(cols.map((c) => c.column_name)).not.toContain('country');
      const a = await dashAudit('https://v.fr/', tok('v'));
      await expect(
        t.sql`insert into audit_views (audit_id, user_agent) values (${a.auditId}, ${'x'.repeat(201)})`,
      ).rejects.toMatchObject({ code: '23514' });
    });
  });
});
