import { closeSql, getSql } from './client.js';
import { runMigrations } from './migrate.js';

/** `pnpm db:migrate`: applies pending migrations against DATABASE_URL. */
async function main(): Promise<void> {
  try {
    const result = await runMigrations(getSql());
    for (const v of result.applied) console.warn(`applied ${v}`);
    console.warn(
      `migrations: ${String(result.applied.length)} applied, ${String(result.skipped.length)} already up to date`,
    );
  } finally {
    await closeSql();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
