import { NextResponse, type NextRequest } from 'next/server';

import { getFullAuditBySlug } from '@/lib/db/queries-full';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { slug } = await params;
  const result = await getFullAuditBySlug(slug);

  if (result.kind === 'not_found') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (result.kind === 'error') {
    return NextResponse.json({ error: 'fetch_failed' }, { status: 500 });
  }
  return NextResponse.json(result.audit);
}
