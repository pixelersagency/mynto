import { NextResponse, type NextRequest } from 'next/server';

import { trustedClientIp } from '@/lib/client-ip';
import { logger } from '@/lib/logger';
import { rateLimit } from '@/lib/rate-limit';
import { getScannerRadar, postScannerRadar, type ScannerResponse } from '@/lib/scanner/client';

/**
 * Thin proxies <install>/api/radar/* -> scanner /api/radar/*.
 *
 * The web layer never checks the Radar API key itself: it only refuses a
 * header that is not even shaped like a bearer token, then forwards it
 * untouched. The scanner owns the constant-time comparison and the 503
 * when RADAR_API_KEY is unset.
 */

const BEARER_SHAPE = /^Bearer \S{1,512}$/;
const PER_IP_LIMIT = 120;
const WINDOW_MS = 60_000;

export const AUDIT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RadarAuthCheck =
  | { ok: true; authorization: string; clientIp: string | null }
  | { ok: false; response: NextResponse };

export function checkRadarRequest(req: NextRequest): RadarAuthCheck {
  const clientIp = trustedClientIp(req.headers);
  const limit = rateLimit(`radar-api:${clientIp ?? 'unknown'}`, PER_IP_LIMIT, WINDOW_MS);
  if (!limit.ok) {
    return { ok: false, response: NextResponse.json({ error: 'rate_limited' }, { status: 429 }) };
  }
  const authorization = req.headers.get('authorization');
  if (authorization === null || !BEARER_SHAPE.test(authorization)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    };
  }
  return { ok: true, authorization, clientIp };
}

export async function forwardRadar(
  method: 'GET' | 'POST',
  path: string,
  payload: unknown,
  opts: { authorization?: string; clientIp: string | null; userAgent?: string },
): Promise<NextResponse> {
  try {
    const forward = {
      clientIp: opts.clientIp,
      forwardedFor: null,
      authorization: opts.authorization,
      userAgent: opts.userAgent,
    };
    const scanner: ScannerResponse =
      method === 'GET'
        ? await getScannerRadar(path, forward)
        : await postScannerRadar(path, payload, forward);
    return NextResponse.json(scanner.body, {
      status: scanner.status,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (err) {
    const name = (err as Error).name;
    if (name === 'AbortError') {
      logger.warn('radar_proxy_timeout');
      return NextResponse.json({ error: 'upstream_timeout' }, { status: 504 });
    }
    logger.error({ err: (err as Error).message }, 'radar_proxy_error');
    return NextResponse.json({ error: 'upstream_error' }, { status: 502 });
  }
}
