import { NextResponse, type NextRequest } from 'next/server';

import { AUDIT_ID_PATTERN, checkRadarRequest, forwardRadar } from '@/lib/radar/proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ auditId: string }>;
}

/**
 * Radar -> POST <install>/api/radar/audits/:audit_id/interpret
 * Called when the outreach email is validated: runs the deferred narrative.
 */
export async function POST(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const check = checkRadarRequest(req);
  if (!check.ok) return check.response;
  const { auditId } = await params;
  if (!AUDIT_ID_PATTERN.test(auditId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return forwardRadar(
    'POST',
    `/audits/${auditId}/interpret`,
    {},
    {
      authorization: check.authorization,
      clientIp: check.clientIp,
    },
  );
}
