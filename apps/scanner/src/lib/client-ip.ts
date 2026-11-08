import type { FastifyRequest } from 'fastify';

/**
 * Clé de rate limiting : l'IP écrite par notre propre proxy, jamais celle
 * annoncée par l'appelant.
 *
 * `trustProxy: true` fait que `req.ip` vaut l'entrée la PLUS À GAUCHE de
 * `X-Forwarded-For`, c'est-à-dire celle que n'importe qui peut inventer.
 * Un `curl -H 'X-Forwarded-For: <aléatoire>'` obtient donc un compteur
 * neuf à chaque requête, ce qui vide le quota de son sens.
 *
 * Le dernier hop, lui, est ajouté par le maillon juste devant nous :
 * Traefik en frontal, ou le proxy Next qui appose l'IP retenue par
 * `trustedClientIp` avant d'appeler ce service. C'est la seule entrée
 * qu'un client distant ne peut pas choisir.
 *
 * Sans en-tête exploitable, on retombe sur l'adresse de la socket.
 */
export function rateLimitKey(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded.join(',') : forwarded;
  if (raw !== undefined) {
    const last = raw
      .split(',')
      .map((hop) => hop.trim())
      .filter((hop) => hop.length > 0)
      .at(-1);
    if (last !== undefined) return last;
  }

  const real = req.headers['x-real-ip'];
  const realValue = Array.isArray(real) ? real[0] : real;
  if (realValue !== undefined && realValue.trim().length > 0) return realValue.trim();

  return req.socket.remoteAddress ?? req.ip;
}
