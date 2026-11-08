import { TEMPLATE_ID_PATTERN } from '@mynto/templates';
import { NextResponse, type NextRequest } from 'next/server';

import { getAdminSession } from '@/lib/auth/admin';
import { loadTemplateBundle } from '@/lib/reports/templates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** preview.png of a template (gallery thumbnail). */
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
  if (!bundle?.preview) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const bytes = Buffer.from(bundle.preview, 'base64');
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
