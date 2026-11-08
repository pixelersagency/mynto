import { describe, expect, it } from 'vitest';

import { runMigrations } from '../src/migrate.js';

import { ISO_RE, hasDatabase, testSlug, useTestDb } from './helpers.js';

describe.skipIf(!hasDatabase)('migrations', () => {
  const t = useTestDb();

  it('is idempotent and records versions', async () => {
    const again = await runMigrations(t.sql);
    expect(again.applied).toEqual([]);
    expect(again.skipped).toContain('0001_init');
    const rows = await t.sql<{ version: string }[]>`select version from schema_migrations`;
    expect(rows.map((r) => r.version)).toContain('0001_init');
  });

  it('runs concurrently without double-applying', async () => {
    const [a, b] = await Promise.all([runMigrations(t.sql), runMigrations(t.sql)]);
    expect([...a.applied, ...b.applied]).toEqual([]);
  });

  it('creates only the kept tables, without RLS', async () => {
    const tables = await t.sql<{ tablename: string; rowsecurity: boolean }[]>`
      select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename
    `;
    expect(tables.map((r) => r.tablename)).toEqual([
      'agency_settings',
      'ai_provider_keys',
      'ai_settings',
      'api_keys',
      'audit_findings_full',
      'audit_settings',
      'audit_views',
      'audits_full',
      'email_sends',
      'radar_audit_views',
      'radar_audits',
      'report_settings',
      'report_template_state',
      'report_templates',
      'schema_migrations',
      'smtp_settings',
      'webhook_deliveries',
      'webhook_delivery_attempts',
      'webhook_endpoints',
      'webhook_events',
    ]);
    expect(tables.every((r) => !r.rowsecurity)).toBe(true);
    const cols = await t.sql<{ column_name: string }[]>`
      select column_name from information_schema.columns where table_name = 'audits_full'
    `;
    const names = cols.map((c) => c.column_name);
    for (const dropped of ['tier', 'unlocked_axes', 'site_id', 'user_id', 'hero_screenshot_url']) {
      expect(names).not.toContain(dropped);
    }
    expect(names).toContain('hero_screenshot_key');
  });

  it('accepts an audit without email and applies defaults', async () => {
    const slug = testSlug();
    await t.sql`insert into audits_full (slug, url) values (${slug}, 'https://example.com/')`;
    const [row] = await t.sql<
      {
        email: string | null;
        source: string;
        status: string;
        expires_at: string;
        created_at: string;
      }[]
    >`select email, source, status, expires_at, created_at from audits_full where slug = ${slug}`;
    expect(row?.email).toBeNull();
    expect(row?.source).toBe('web');
    expect(row?.status).toBe('queued');
    expect(row?.created_at).toMatch(ISO_RE);
    const days =
      (Date.parse(row?.expires_at ?? '') - Date.parse(row?.created_at ?? '')) / 86_400_000;
    expect(Math.round(days)).toBe(60);
  });

  it('enforces the CHECK constraints', async () => {
    await expect(
      t.sql`insert into audits_full (slug, url, status) values (${testSlug()}, 'https://e.x/', 'bogus')`,
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      t.sql`insert into audits_full (slug, url, source) values (${testSlug()}, 'https://e.x/', 'other')`,
    ).rejects.toMatchObject({ code: '23514' });
    const big = { blob: 'x'.repeat(500_001) };
    await expect(
      t.sql`insert into audits_full (slug, url, llm_input) values (${testSlug()}, 'https://e.x/', ${t.sql.json(big)})`,
    ).rejects.toMatchObject({ code: '23514', constraint_name: 'audits_full_llm_input_size' });
  });
});
