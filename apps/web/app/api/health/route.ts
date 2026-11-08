import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness of the web app (no dependency check, no data). */
export function GET(): NextResponse {
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
}
