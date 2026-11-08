import { NextResponse, type NextRequest } from 'next/server';

import { getMediaStorage } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILE_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(png|ico|jpg|gif|webp)$/;
const TYPES = {
  png: 'image/png',
  ico: 'image/x-icon',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
} as const;

/** Site favicon fetched by the scanner (raster only, checked by magic bytes there). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ file: string }> },
): Promise<NextResponse> {
  const { file } = await params;
  const m = FILE_RE.exec(file);
  if (!m) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let bytes: Buffer | null;
  try {
    bytes = await getMediaStorage().get(`favicon/${file}`);
  } catch (err) {
    logger.error(
      { message: err instanceof Error ? err.message : 'unknown' },
      'favicon_read_failed',
    );
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }
  if (bytes === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': TYPES[m[2] as keyof typeof TYPES],
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
