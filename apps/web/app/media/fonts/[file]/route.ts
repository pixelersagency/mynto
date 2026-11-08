import { NextResponse, type NextRequest } from 'next/server';

import { getMediaStorage } from '@/lib/db';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FILE_RE = /^[a-z0-9]{8,32}\.woff2$/;

/** Custom report font uploaded by the agency (woff2, checked at upload). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ file: string }> },
): Promise<NextResponse> {
  const { file } = await params;
  if (!FILE_RE.test(file)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  let bytes: Buffer | null;
  try {
    bytes = await getMediaStorage().get(`fonts/${file}`);
  } catch (err) {
    logger.error({ message: err instanceof Error ? err.message : 'unknown' }, 'font_read_failed');
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }
  if (bytes === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': 'font/woff2',
      'Content-Length': String(bytes.length),
      // The key is random per upload: safe to cache for long.
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
