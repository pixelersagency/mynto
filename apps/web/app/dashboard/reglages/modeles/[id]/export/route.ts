import { TEMPLATE_ID_PATTERN, writeTemplateZip } from '@mynto/templates';
import { NextResponse, type NextRequest } from 'next/server';

import { getAdminSession } from '@/lib/auth/admin';
import { loadTemplateBundle } from '@/lib/reports/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Template as a .zip (manifest, Liquid, CSS, preview), ready to edit and re-import. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  if ((await getAdminSession()) === null)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { id } = await params;
  if (!TEMPLATE_ID_PATTERN.test(id))
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const bundle = await loadTemplateBundle(id);
  if (bundle === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const zip = writeTemplateZip(bundle);
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="modele-${id}.zip"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
