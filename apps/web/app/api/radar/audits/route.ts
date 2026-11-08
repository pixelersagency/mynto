import { RadarCreateAuditRequestSchema } from '@mynto/shared';
import { NextResponse, type NextRequest } from 'next/server';

import { checkRadarRequest, forwardRadar } from '@/lib/radar/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Radar -> POST <install>/api/radar/audits (contract: docs/radar.md). */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const check = checkRadarRequest(req);
  if (!check.ok) return check.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const parsed = RadarCreateAuditRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    );
  }

  // Scanning a site takes a few seconds of URL checks before the insert.
  return forwardRadar('POST', '/audits', parsed.data, {
    authorization: check.authorization,
    clientIp: check.clientIp,
  });
}
