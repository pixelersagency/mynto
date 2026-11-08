import { NextResponse, type NextRequest } from 'next/server';

import { getFullAuditFindingsBySlug } from '@/lib/db/queries-full';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { slug } = await params;
  const findings = await getFullAuditFindingsBySlug(slug);
  return NextResponse.json({ findings });
}
