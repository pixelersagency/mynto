import { RadarViewBeaconSchema } from '@mynto/shared';
import { NextResponse, type NextRequest } from 'next/server';

import { trustedClientIp } from '@/lib/client-ip';
import { forwardRadar } from '@/lib/radar/proxy';
import { rateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 4_096;
const PER_IP_LIMIT = 20;
const WINDOW_MS = 60_000;

/**
 * View beacon of the /r/<token> page (navigator.sendBeacon). Public, no
 * API key: the unguessable token is the gate, plus a per-IP limit here and
 * another one on the scanner. Bot filtering and dedupe happen on the
 * scanner, which receives the browser's User-Agent and the client IP.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const clientIp = trustedClientIp(req.headers);
  if (!rateLimit(`radar-view:${clientIp ?? 'unknown'}`, PER_IP_LIMIT, WINDOW_MS).ok) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 });
  }

  // sendBeacon may post text/plain: read raw text and parse it ourselves.
  const raw = await req.text();
  if (raw.length === 0 || raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = RadarViewBeaconSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  return forwardRadar('POST', '/views', parsed.data, {
    clientIp,
    userAgent: req.headers.get('user-agent') ?? undefined,
  });
}
