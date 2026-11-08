import 'server-only';

import { trustedClientIp } from '../client-ip';
import { db, pgErrorCode } from '../db';
import { getServerEnv } from '../env';
import { logger } from '../logger';
import { sharedRateLimit } from '../rate-limit-shared';

import { apiError } from './http';

/**
 * Bearer API key gate of /api/v1 and /mcp (the middleware lets these paths
 * through to this check). Keys are verified by hash (constant-time compare
 * in the repo); each key has its own rate limit (shared through Redis
 * between web processes when REDIS_URL is set); failed attempts are
 * throttled per client IP. The presented key is never logged.
 */

export interface ApiCaller {
  keyId: string;
  keyName: string;
}

export type AuthResult = { ok: true; caller: ApiCaller } | { ok: false; response: Response };

const FAILS_PER_MINUTE = 20;

function clientKey(req: Request): string {
  return trustedClientIp(req.headers) ?? 'unknown';
}

export function bearerToken(header: string | null): string | null {
  if (header === null) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return m?.[1] ?? null;
}

export async function authenticateApiRequest(req: Request): Promise<AuthResult> {
  const unauthorized = (message: string): AuthResult => ({
    ok: false,
    response: apiError(401, 'unauthorized', message, { 'WWW-Authenticate': 'Bearer' }),
  });

  const ipBucket = `apiauth-fail:${clientKey(req)}`;
  const token = bearerToken(req.headers.get('authorization'));
  if (token === null) {
    return unauthorized('Clé API manquante : en-tête « Authorization: Bearer <clé> ».');
  }

  let verified: { id: string; name: string } | null;
  try {
    verified = await db().apiKeys.verify(token);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'api_key_verify_failed');
    return { ok: false, response: apiError(503, 'unavailable', 'Base de données indisponible.') };
  }
  if (verified === null) {
    if (!(await sharedRateLimit(ipBucket, FAILS_PER_MINUTE, 60_000)).ok) {
      return {
        ok: false,
        response: apiError(429, 'rate_limited', 'Trop d’essais. Réessaye dans une minute.', {
          'Retry-After': '60',
        }),
      };
    }
    logger.warn('api_key_rejected');
    return unauthorized('Clé API invalide ou révoquée.');
  }

  const limit = getServerEnv().API_RATE_LIMIT_PER_MINUTE;
  const rl = await sharedRateLimit(`apikey:${verified.id}`, limit, 60_000);
  if (!rl.ok) {
    logger.warn({ keyId: verified.id }, 'api_key_rate_limited');
    return {
      ok: false,
      response: apiError(429, 'rate_limited', `Limite de ${String(limit)} requêtes par minute.`, {
        'Retry-After': '60',
      }),
    };
  }
  return { ok: true, caller: { keyId: verified.id, keyName: verified.name } };
}
