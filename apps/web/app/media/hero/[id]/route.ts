import { NextResponse, type NextRequest } from 'next/server';

import { getMediaStorage, heroKey, isUuid } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Hero screenshot of an audit, read from the media store (MEDIA_DIR,
 * `hero/<auditId>.png`, written by the scanner). The id is validated as a
 * UUID before it reaches the filesystem; the `.png` suffix is optional so
 * both /media/hero/<id> and /media/hero/<id>.png work.
 */
export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const { id: raw } = await params;
  const id = raw.endsWith('.png') ? raw.slice(0, -4) : raw;
  if (!isUuid(id)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  let bytes: Buffer | null;
  try {
    bytes = await getMediaStorage().get(heroKey(id));
  } catch (err) {
    logger.error({ message: err instanceof Error ? err.message : 'unknown' }, 'hero_read_failed');
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }
  if (bytes === null) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Content-Length': String(bytes.length),
      // The scanner overwrites the file when an audit is re-run: 1h, like
      // the former Storage bucket.
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
