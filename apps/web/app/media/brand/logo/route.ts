import { LOGO_KEY_PATTERN } from '@mynto/db';
import { NextResponse } from 'next/server';

import { db, getMediaStorage, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';
import { logoContentType } from '@/lib/logo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Agency logo (agency_settings.logo_key, file in MEDIA_DIR). Public: it is
 * shown on public reports. The URL carries ?v=<key> so it can be cached
 * long; only PNG / JPEG keys exist (SVG is refused at upload).
 */
export async function GET(): Promise<NextResponse> {
  let key: string | null = null;
  try {
    key = (await db().settings.get())?.logo_key ?? null;
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'brand_logo_lookup_failed');
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }
  const type = key !== null && LOGO_KEY_PATTERN.test(key) ? logoContentType(key) : null;
  if (key === null || type === null)
    return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let bytes: Buffer | null;
  try {
    bytes = await getMediaStorage().get(key);
  } catch (err) {
    logger.error(
      { message: err instanceof Error ? err.message : 'unknown' },
      'brand_logo_read_failed',
    );
    return NextResponse.json({ error: 'read_failed' }, { status: 500 });
  }
  if (bytes === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': type,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}
