import type { NextRequest, NextResponse } from 'next/server';

import { iconResponse } from '@/lib/favicon-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Effective favicon of the instance: agency favicon, else agency logo
 * (fitted on a square), else the default Mynto icon. Public: it is shown on
 * the login page and on public reports. Linked from the root layout with
 * ?v=<version>.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return iconResponse('favicon', req.nextUrl.searchParams.get('v'));
}
