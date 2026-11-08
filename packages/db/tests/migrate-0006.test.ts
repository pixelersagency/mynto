import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSql, type Sql } from '../src/client.js';
import { DEFAULT_MIGRATIONS_DIR, listMigrationFiles, runMigrations } from '../src/migrate.js';

import { databaseUrl, hasDatabase, testSlug } from './helpers.js';

describe.skipIf(!hasDatabase)('migration 0006: audit_views upgraded in place', () => {
  let sql: Sql;
  let dir: string;

  beforeAll(async () => {
    sql = createSql(databaseUrl ?? '', { max: 2 });
    await sql`drop schema if exists public cascade`;
    await sql`create schema public`;
    dir = await mkdtemp(path.join(tmpdir(), 'mynto-mig-'));
    for (const f of await listMigrationFiles()) {
      if (f < '0006') await copyFile(path.join(DEFAULT_MIGRATIONS_DIR, f), path.join(dir, f));
    }
    await runMigrations(sql, dir);
  });

  afterAll(async () => {
    await sql`drop schema if exists public cascade`;
    await sql`create schema public`;
    await sql.end({ timeout: 5 });
    await rm(dir, { recursive: true, force: true });
  });

  it('turns raw User-Agents into families and drops the country', async () => {
    const [a] = await sql<{ id: string }[]>`
      insert into audits_full (slug, url) values (${testSlug()}, 'https://ua.fr/') returning id
    `;
    const id = a?.id ?? '';
    const iphone =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
    const chrome =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    await sql`
      insert into audit_views (audit_id, user_agent, country) values
        (${id}, ${iphone}, 'FR'), (${id}, ${chrome}, 'BE'), (${id}, null, null)
    `;
    const res = await runMigrations(sql);
    expect(res.applied[0]).toBe('0006_audit_views_minimal');
    const rows = await sql<{ user_agent: string | null }[]>`
      select user_agent from audit_views order by user_agent nulls last
    `;
    expect(rows.map((r) => r.user_agent)).toEqual(['Chrome, ordinateur', 'Safari, mobile', null]);
  });
});
