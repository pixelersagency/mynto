import { ping } from '@mynto/db';
import type { FastifyInstance } from 'fastify';

import { AUDIT_USER_AGENT } from '../audit/collectors/http.js';
import { safeFetch } from '../audit/collectors/safe-fetch.js';
import { verifyAdminToken } from '../lib/admin-auth.js';
import { logger } from '../logger.js';
import { redis } from '../redis.js';

/**
 * Target of the outbound self-test. Stable, IANA-run, dual-stack, and
 * unrelated to us, so a failure points at our egress and not at one
 * customer's host.
 */
const OUTBOUND_PROBE_URL = 'https://example.com/';
const OUTBOUND_TIMEOUT_MS = 5_000;
const OUTBOUND_CACHE_MS = 30_000;

interface OutboundResult {
  ok: boolean;
  reason: string;
  at: number;
}

let cached: OutboundResult | null = null;
let inFlight: Promise<OutboundResult> | null = null;

/**
 * Checks that the scanner can actually reach the public internet through
 * `safeFetch`, dispatcher pinning included. Every audit depends on it,
 * and when it breaks the audits still complete: they just score 0 on
 * every check, which reads as "this site is invisible" instead of "our
 * scanner is down". This is the probe that tells the two apart.
 */
async function checkOutbound(): Promise<OutboundResult> {
  const now = Date.now();
  if (cached !== null && now - cached.at < OUTBOUND_CACHE_MS) return cached;
  // The cache is only written once the probe resolves, so without this
  // concurrent callers would each open their own socket and their own
  // dispatcher during the 5s window.
  inFlight ??= runOutbound().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runOutbound(): Promise<OutboundResult> {
  const now = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, OUTBOUND_TIMEOUT_MS);
  try {
    const res = await safeFetch(OUTBOUND_PROBE_URL, {
      method: 'HEAD',
      signal: ctrl.signal,
      headers: { 'User-Agent': AUDIT_USER_AGENT },
    });
    cached = res.ok
      ? { ok: true, reason: `http_${String(res.response.status)}`, at: now }
      : { ok: false, reason: `${res.kind}:${res.reason}`, at: now };
  } catch (err) {
    cached = { ok: false, reason: `threw:${(err as Error).message}`, at: now };
  } finally {
    clearTimeout(timer);
  }

  if (!cached.ok) {
    logger.error({ url: OUTBOUND_PROBE_URL, reason: cached.reason }, 'outbound_probe_failed');
  }
  return cached;
}

/** Boot-time egress check. Logged, never thrown: it must not stop the server. */
export async function logOutboundStatus(): Promise<void> {
  const outbound = await checkOutbound();
  if (outbound.ok) {
    logger.info({ url: OUTBOUND_PROBE_URL, reason: outbound.reason }, 'outbound_probe_ok');
  }
  // The failure path already logs at error level inside checkOutbound.
}

export function registerHealthRoute(app: FastifyInstance): void {
  app.get('/health', async (req, reply) => {
    const checks: Record<string, boolean> = { server: true };

    try {
      await redis.ping();
      checks.redis = true;
    } catch {
      checks.redis = false;
    }

    try {
      await ping();
      checks.database = true;
    } catch {
      checks.database = false;
    }

    // Admin-only, and opt-in even then: the container healthcheck runs
    // every few seconds and has no business calling a third party that
    // often. Gating the whole probe rather than just its reason keeps an
    // anonymous caller from making us open outbound sockets on demand,
    // and from learning that our egress is down.
    const wantsOutbound = (req.query as { outbound?: string }).outbound === '1';
    let outboundReason: string | null = null;
    if (wantsOutbound && verifyAdminToken(req.headers['x-admin-token'])) {
      const outbound = await checkOutbound();
      checks.outbound = outbound.ok;
      outboundReason = outbound.reason;
    }

    const ok = Object.values(checks).every((v) => v);
    return reply
      .code(ok ? 200 : 503)
      .send({ ok, checks, ...(outboundReason === null ? {} : { outboundReason }) });
  });
}
