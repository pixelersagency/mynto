import type { NextRequest, NextResponse } from 'next/server';

import { iconResponse } from '@/lib/favicon-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Touch icon (180 x 180 PNG on white): PNG favicon, else agency logo, else
 * the default Mynto icon when the agency set neither. 404 when the only
 * agency icon is an SVG or ICO favicon (no touch icon is linked then).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return iconResponse('apple', req.nextUrl.searchParams.get('v'));
}
