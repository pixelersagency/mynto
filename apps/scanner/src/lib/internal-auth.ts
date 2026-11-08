import type { FastifyReply, FastifyRequest } from 'fastify';

import { config } from '../config.js';

import { INTERNAL_TOKEN_HEADER, verifyInternalToken } from './internal-token.js';

/**
 * Gate of the audit write routes (create, refresh, delete). 503 when the
 * token is not configured, so a half-configured deploy is never open; 401
 * on a missing or wrong token. Returns false when the reply was sent.
 */
export function requireInternalToken(req: FastifyRequest, reply: FastifyReply): boolean {
  if (config.SCANNER_INTERNAL_TOKEN === undefined) {
    void reply.code(503).send({ error: 'internal_auth_not_configured' });
    return false;
  }
  if (!verifyInternalToken(req.headers[INTERNAL_TOKEN_HEADER], config.SCANNER_INTERNAL_TOKEN)) {
    req.log.warn('internal_auth_failed');
    void reply.code(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}
