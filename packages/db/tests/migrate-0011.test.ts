import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createSql, type Sql } from '../src/client.js';
import { DEFAULT_MIGRATIONS_DIR, listMigrationFiles, runMigrations } from '../src/migrate.js';

import { databaseUrl, hasDatabase } from './helpers.js';

describe.skipIf(!hasDatabase)('migration 0011: agency favicon', () => {
  let sql: Sql;
  let dir: string;

  beforeAll(async () => {
    sql = createSql(databaseUrl ?? '', { max: 2 });
    await sql`drop schema if exists public cascade`;
    await sql`create schema public`;
    dir = await mkdtemp(path.join(tmpdir(), 'mynto-mig-'));
    for (const f of await listMigrationFiles()) {
      if (f < '0011') await copyFile(path.join(DEFAULT_MIGRATIONS_DIR, f), path.join(dir, f));
    }
    await runMigrations(sql, dir);
  });

  afterAll(async () => {
    await sql`drop schema if exists public cascade`;
    await sql`create schema public`;
    await sql.end({ timeout: 5 });
    await rm(dir, { recursive: true, force: true });
  });

  it('adds a nullable favicon_key and keeps the existing branding', async () => {
    await sql`
      insert into agency_settings (id, name, logo_key)
      values (true, 'Agence Démo', 'brand/logo-abcdefgh.png')
    `;
    const res = await runMigrations(sql);
    expect(res.applied).toContain('0011_agency_favicon');

    const [row] = await sql<{ name: string; logo_key: string; favicon_key: string | null }[]>`
      select name, logo_key, favicon_key from agency_settings
    `;
    expect(row).toEqual({
      name: 'Agence Démo',
      logo_key: 'brand/logo-abcdefgh.png',
      favicon_key: null,
    });

    await sql`update agency_settings set favicon_key = 'brand/favicon-abcdefgh.svg'`;
    for (const bad of [
      'brand/favicon-abcdefgh.html',
      'brand/favicon-ABC.png',
      '../favicon-abcdefgh.png',
      'brand/logo-abcdefgh.png',
    ]) {
      await expect(sql`update agency_settings set favicon_key = ${bad}`).rejects.toThrow(
        /agency_settings_favicon_key_check/,
      );
    }
  });
});
