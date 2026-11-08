import { TEMPLATE_ID_PATTERN, toDocument } from '@mynto/templates';
import { NextResponse, type NextRequest } from 'next/server';

import { getAdminSession } from '@/lib/auth/admin';
import { db } from '@/lib/db';
import { renderTemplatePreview } from '@/lib/reports/render';
import { loadTemplateBundle } from '@/lib/reports/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Full-page preview of a template on the example audit (?mode=print for the PDF layout). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if ((await getAdminSession()) === null)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!TEMPLATE_ID_PATTERN.test(id))
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const bundle = await loadTemplateBundle(id);
  if (bundle === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const state = await db().reports.getState(id);
  const mode = req.nextUrl.searchParams.get('mode') === 'print' ? 'print' : 'web';
  const out = await renderTemplatePreview(bundle, state?.settings ?? {}, mode);
  return new NextResponse(toDocument(out, `Aperçu : ${bundle.manifest.name}`), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}
