import postgres from 'postgres';

/** Full client (can open transactions). */
export type Sql = postgres.Sql;
/** Anything that can run a query: the client or a transaction handle. */
export type Queryable = postgres.ISql;

export interface CreateSqlOptions {
  /** Pool size. Defaults to 10. */
  max?: number;
}

/**
 * Builds a postgres.js client with the value shapes the callers were
 * written against (they used to read through PostgREST):
 *   - numeric -> JS number (postgres.js returns strings by default);
 *   - timestamp / timestamptz -> ISO 8601 string (not Date objects);
 *   - `undefined` parameters -> NULL instead of throwing.
 */
export function createSql(url: string, options: CreateSqlOptions = {}): Sql {
  const sql = postgres(url, {
    max: options.max ?? 10,
    idle_timeout: 30,
    connect_timeout: 10,
    onnotice: () => undefined,
    transform: { undefined: null },
    types: {
      numeric: {
        to: 1700,
        from: [1700],
        serialize: (x: number | string) => String(x),
        parse: (x: string) => Number(x),
      },
      timestamptz: {
        to: 1184,
        from: [1114, 1184],
        serialize: (x: Date | string) => (x instanceof Date ? x : new Date(x)).toISOString(),
        parse: (x: string) => new Date(x).toISOString(),
      },
    },
  });
  return sql as unknown as Sql;
}

let shared: Sql | null = null;

/**
 * Lazily created process-wide client, configured from DATABASE_URL.
 * Throws when DATABASE_URL is missing so a misconfigured deploy fails on
 * first use with a clear message.
 */
export function getSql(): Sql {
  if (shared !== null) return shared;
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.length === 0) {
    throw new Error('DATABASE_URL is not set');
  }
  shared = createSql(url);
  return shared;
}

/** Closes the shared client (graceful shutdown, tests). */
export async function closeSql(): Promise<void> {
  if (shared === null) return;
  const s = shared;
  shared = null;
  await s.end({ timeout: 5 });
}

/** True for a Postgres unique_violation (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === '23505';
}

/** SQLSTATE of a Postgres error, if any. Safe to log (no data). */
export function pgErrorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const code = (err as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/** Wraps a JSON-serialisable value for a jsonb parameter (null stays NULL). */
export function jsonb(sql: Queryable, value: unknown): postgres.Parameter | null {
  if (value === null || value === undefined) return null;
  return sql.json(value as postgres.JSONValue);
}
