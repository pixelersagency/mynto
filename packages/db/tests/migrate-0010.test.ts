import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSql, type Sql } from '../src/client.js';
import { DEFAULT_MIGRATIONS_DIR, listMigrationFiles, runMigrations } from '../src/migrate.js';

import { databaseUrl, hasDatabase, testSlug } from './helpers.js';

describe.skipIf(!hasDatabase)('migration 0010: report templates v2', () => {
  let sql: Sql;
  let dir: string;

  beforeAll(async () => {
    sql = createSql(databaseUrl ?? '', { max: 2 });
    await sql`drop schema if exists public cascade`;
    await sql`create schema public`;
    dir = await mkdtemp(path.join(tmpdir(), 'mynto-mig-'));
    for (const f of await listMigrationFiles()) {
      if (f < '0010') await copyFile(path.join(DEFAULT_MIGRATIONS_DIR, f), path.join(dir, f));
    }
    await runMigrations(sql, dir);
  });

  afterAll(async () => {
    await sql`drop schema if exists public cascade`;
    await sql`create schema public`;
    await sql.end({ timeout: 5 });
    await rm(dir, { recursive: true, force: true });
  });

  it('maps the retired built-in ids and keeps the saved settings', async () => {
    const audit = async (templateId: string): Promise<string> => {
      const [a] = await sql<{ id: string }[]>`
        insert into audits_full (slug, url, template_id)
        values (${testSlug()}, 'https://acme.fr/', ${templateId}) returning id
      `;
      return a?.id ?? '';
    };
    const std = await audit('standard');
    const cmp = await audit('compact');
    const com = await audit('commercial');
    const own = await audit('mynto');
    await sql`insert into report_settings (id, default_template_id) values (true, 'compact')`;
    await sql`
      insert into report_template_state (template_id, enabled, settings) values
        ('standard', true, '{"cta_title":"Standard"}'),
        ('compact', true, '{"cta_title":"Compact"}'),
        ('commercial', false, '{"offer":"Forfait 900 €"}')
    `;
    // A custom template that took a new built-in id before v2.
    await sql`
      insert into report_templates (id, manifest, files)
      values ('mynto', '{"id":"mynto","name":"Maison"}', '{}')
    `;

    const res = await runMigrations(sql);
    expect(res.applied).toContain('0010_report_templates_v2');

    const rows = await sql<{ id: string; template_id: string | null }[]>`
      select id, template_id from audits_full
    `;
    const by = new Map(rows.map((r) => [r.id, r.template_id]));
    expect(by.get(std)).toBe('minimal');
    expect(by.get(cmp)).toBe('minimal');
    expect(by.get(com)).toBe('mynto');
    expect(by.get(own)).toBe('mynto-perso');

    const [custom] = await sql<{ id: string; manifest: { id: string } }[]>`
      select id, manifest from report_templates
    `;
    expect(custom).toMatchObject({ id: 'mynto-perso', manifest: { id: 'mynto-perso' } });

    const [settings] = await sql<{ default_template_id: string }[]>`
      select default_template_id from report_settings
    `;
    expect(settings?.default_template_id).toBe('minimal');

    const states = await sql<
      { template_id: string; enabled: boolean; settings: Record<string, string> }[]
    >`select template_id, enabled, settings from report_template_state order by template_id`;
    expect(states).toEqual([
      // The old default (compact) wins over standard.
      { template_id: 'minimal', enabled: true, settings: { cta_title: 'Compact' } },
      { template_id: 'mynto', enabled: false, settings: { offer: 'Forfait 900 €' } },
    ]);

    await sql`delete from report_settings`;
    await sql`insert into report_settings (id) values (true)`;
    const [fresh] = await sql<{ default_template_id: string }[]>`
      select default_template_id from report_settings
    `;
    expect(fresh?.default_template_id).toBe('minimal');
  });
});
