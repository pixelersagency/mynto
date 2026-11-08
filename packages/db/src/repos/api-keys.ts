import { randomBytes, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import type { Sql } from '../client.js';
import { sha256Hex } from '../secrets.js';

/**
 * API keys of the REST API v1 and the MCP server.
 *
 * Format: "myn_live_" + 43 base64url chars (32 random bytes). Only the
 * SHA-256 of the full key is stored (256-bit random secret: no salt or slow
 * hash needed), plus a display prefix. The secret is returned once, by
 * `create`, and never again.
 */

export const API_KEY_PREFIX = 'myn_live_';
const API_KEY_RE = /^myn_live_[A-Za-z0-9_-]{43}$/;

export const ApiKeyNameSchema = z
  .string()
  .trim()
  .min(1, 'Donne un nom à la clé')
  .max(80, '80 caractères maximum');

export interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

export interface CreatedApiKey extends ApiKeyRow {
  /** Full secret. Show it once, never store or log it. */
  secret: string;
}

export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function isApiKeyFormat(value: string): boolean {
  return API_KEY_RE.test(value);
}

/** Last-used timestamps are written at most once per minute per key. */
const LAST_USED_RESOLUTION_S = 60;

export function createApiKeysRepo(sql: Sql) {
  return {
    async create(name: string): Promise<CreatedApiKey> {
      const n = ApiKeyNameSchema.parse(name);
      const secret = generateApiKey();
      const prefix = secret.slice(0, API_KEY_PREFIX.length + 8);
      const [row] = await sql<ApiKeyRow[]>`
        insert into api_keys (name, prefix, key_hash)
        values (${n}, ${prefix}, ${sha256Hex(secret)})
        returning id, name, prefix, created_at, last_used_at, revoked_at
      `;
      if (row === undefined) throw new Error('api_keys insert returned no row');
      return { ...row, secret };
    },

    /** Every key, active ones first, newest first. */
    async list(): Promise<ApiKeyRow[]> {
      return sql<ApiKeyRow[]>`
        select id, name, prefix, created_at, last_used_at, revoked_at
          from api_keys
         order by (revoked_at is null) desc, created_at desc
      `;
    },

    async revoke(id: string): Promise<boolean> {
      const res = await sql`
        update api_keys set revoked_at = now() where id = ${id} and revoked_at is null
      `;
      return res.count > 0;
    },

    /**
     * Active key matching the presented secret, or null. The lookup goes
     * through the unique hash index; the stored hash is then compared in
     * constant time. Updates last_used_at (throttled).
     */
    async verify(presented: string): Promise<{ id: string; name: string } | null> {
      if (!isApiKeyFormat(presented)) return null;
      const hash = sha256Hex(presented);
      const [row] = await sql<{ id: string; name: string; key_hash: string }[]>`
        select id, name, key_hash from api_keys where key_hash = ${hash} and revoked_at is null
      `;
      if (row === undefined) return null;
      const a = Buffer.from(row.key_hash, 'hex');
      const b = Buffer.from(hash, 'hex');
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      await sql`
        update api_keys set last_used_at = now()
         where id = ${row.id}
           and (last_used_at is null
                or last_used_at < now() - make_interval(secs => ${LAST_USED_RESOLUTION_S}))
      `;
      return { id: row.id, name: row.name };
    },
  };
}

export type ApiKeysRepo = ReturnType<typeof createApiKeysRepo>;
