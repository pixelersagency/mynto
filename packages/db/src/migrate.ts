import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import type { Sql } from './client.js';

/** Default location: packages/db/migrations, next to this package's src/. */
export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));

/** Arbitrary constant key for pg_advisory_xact_lock ("mynt" in ASCII). */
const MIGRATION_LOCK_KEY = 0x6d796e74;

const MIGRATION_FILE = /^\d{4}_[a-z0-9_]+\.sql$/;

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/** Lists `NNNN_name.sql` files in lexical (= numeric) order. */
export async function listMigrationFiles(dir: string = DEFAULT_MIGRATIONS_DIR): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((f) => MIGRATION_FILE.test(f)).sort();
}

/**
 * Applies every pending migration, in order, each one in its own
 * transaction together with its `schema_migrations` row. Idempotent:
 * already applied versions are skipped. Safe to run from several
 * processes at once (scanner replicas, `pnpm db:migrate`): each
 * transaction takes the same advisory lock before checking the version.
 */
export async function runMigrations(
  sql: Sql,
  dir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<MigrationResult> {
  const files = await listMigrationFiles(dir);
  const result: MigrationResult = { applied: [], skipped: [] };

  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    const content = await readFile(`${dir.replace(/\/$/, '')}/${file}`, 'utf8');
    const applied = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(${MIGRATION_LOCK_KEY})`;
      await tx`
        create table if not exists schema_migrations (
          version text primary key,
          applied_at timestamptz not null default now()
        )
      `;
      const existing = await tx`select 1 from schema_migrations where version = ${version}`;
      if (existing.length > 0) return false;
      await tx.unsafe(content);
      await tx`insert into schema_migrations (version) values (${version})`;
      return true;
    });
    (applied ? result.applied : result.skipped).push(version);
  }
  return result;
}
