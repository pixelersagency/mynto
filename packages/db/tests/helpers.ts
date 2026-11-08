import { afterAll, beforeAll, beforeEach, inject } from 'vitest';

import { createSql, type Sql } from '../src/client.js';
import { createRepos, type Repos } from '../src/index.js';
import { runMigrations } from '../src/migrate.js';

export const databaseUrl = inject('databaseUrl');
export const hasDatabase = databaseUrl !== null;

export interface TestDb {
  sql: Sql;
  repos: Repos;
}

/**
 * Per-file harness: fresh `public` schema + migrations once, tables
 * truncated before every test. Only call it inside a `describe.skipIf(!hasDatabase)`.
 */
export function useTestDb(): TestDb {
  const ctx = {} as TestDb;
  beforeAll(async () => {
    if (databaseUrl === null) throw new Error('no test database');
    ctx.sql = createSql(databaseUrl, { max: 5 });
    await ctx.sql`drop schema if exists public cascade`;
    await ctx.sql`create schema public`;
    await runMigrations(ctx.sql);
    ctx.repos = createRepos(ctx.sql);
  });
  beforeEach(async () => {
    await ctx.sql`
      truncate audits_full, audit_findings_full, audit_views, radar_audits, radar_audit_views,
        agency_settings, audit_settings, ai_settings, ai_provider_keys, api_keys,
        report_settings, report_templates, report_template_state, smtp_settings, email_sends,
        webhook_endpoints, webhook_events, webhook_deliveries, webhook_delivery_attempts cascade
    `;
  });
  afterAll(async () => {
    await ctx.sql.end({ timeout: 5 });
  });
  return ctx;
}

let slugCounter = 0;
/** Slug matching SLUG_PATTERN (10-20 URL-safe chars). */
export function testSlug(): string {
  slugCounter += 1;
  return `t${String(Date.now()).slice(-8)}${String(slugCounter).padStart(4, '0')}x`;
}

export const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
