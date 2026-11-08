import 'server-only';

import { NextResponse } from 'next/server';

import {
  DEFAULT_ICON_SVG,
  appleIconSources,
  faviconSources,
  iconVersion,
  imageSize,
  type IconKeys,
  type IconSource,
} from './favicon';
import { containSquarePng, defaultAppleIconPng } from './favicon-render';

import { db, getMediaStorage, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';
import { MEDIA_CSP } from '@/lib/security-headers';

/**
 * Serving of the effective favicon and touch icon (/media/brand/favicon,
 * /media/brand/apple-icon). The source is resolved on every request (one
 * single-row read); the URL carries ?v=<version> so a matching request is
 * cached for a year and a change of favicon or logo changes the URL.
 */

export type IconKind = 'favicon' | 'apple';

const LONG_CACHE = 'public, max-age=31536000, immutable';
const SHORT_CACHE = 'public, max-age=300';

interface Served {
  body: Uint8Array;
  contentType: string;
}

async function readKeys(): Promise<IconKeys | null> {
  try {
    const row = await db().settings.get();
    return { favicon_key: row?.favicon_key ?? null, logo_key: row?.logo_key ?? null };
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'brand_icon_lookup_failed');
    return null;
  }
}

async function readMedia(key: string): Promise<Buffer | null> {
  try {
    return await getMediaStorage().get(key);
  } catch (err) {
    logger.error(
      { message: err instanceof Error ? err.message : 'unknown' },
      'brand_icon_read_failed',
    );
    return null;
  }
}

async function fitted(
  key: string,
  bytes: Buffer,
  type: 'image/png' | 'image/jpeg',
  kind: IconKind,
): Promise<Buffer | null> {
  try {
    return kind === 'apple'
      ? await containSquarePng(key, bytes, type, {
          size: 180,
          padding: 0.08,
          background: '#ffffff',
        })
      : await containSquarePng(key, bytes, type, { size: 256 });
  } catch (err) {
    logger.warn(
      { message: err instanceof Error ? err.message : 'unknown' },
      'brand_icon_render_failed',
    );
    return null;
  }
}

const SVG_UTF8 = 'image/svg+xml; charset=utf-8';

async function serveSource(source: IconSource, kind: IconKind): Promise<Served | null> {
  if (source.kind === 'default') {
    return kind === 'apple'
      ? { body: await defaultAppleIconPng(), contentType: 'image/png' }
      : { body: new TextEncoder().encode(DEFAULT_ICON_SVG), contentType: SVG_UTF8 };
  }
  const bytes = await readMedia(source.key);
  if (bytes === null) return null;
  const type = source.contentType;
  if (type === 'image/svg+xml' || type === 'image/x-icon') {
    // The HTTP charset overrides any encoding declared inside the SVG.
    return kind === 'apple'
      ? null
      : { body: bytes, contentType: type === 'image/svg+xml' ? SVG_UTF8 : type };
  }
  // Raster: a square favicon PNG is served as is, everything else is fitted.
  const dims = imageSize(bytes);
  const square = dims !== null && dims.width === dims.height;
  if (kind === 'favicon' && square && type === 'image/png') {
    return { body: bytes, contentType: type };
  }
  const png = await fitted(source.key, bytes, type, kind);
  if (png !== null) return { body: png, contentType: 'image/png' };
  return kind === 'favicon' ? { body: bytes, contentType: type } : null;
}

/** Response of the icon routes. `requested` is the ?v= of the request. */
export async function iconResponse(
  kind: IconKind,
  requested: string | null,
): Promise<NextResponse> {
  const keys = await readKeys();
  const sources =
    keys === null
      ? [{ kind: 'default' } as const]
      : kind === 'apple'
        ? appleIconSources(keys)
        : faviconSources(keys);
  const version = iconVersion(sources);

  let served: Served | null = null;
  let fellBack = false;
  for (const source of sources) {
    served = await serveSource(source, kind);
    if (served !== null) break;
    fellBack = true;
  }
  if (served === null) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Only the exact, healthy answer of a versioned URL is cached for long.
  const cacheControl =
    keys !== null && !fellBack && requested === version ? LONG_CACHE : SHORT_CACHE;
  return new NextResponse(new Uint8Array(served.body), {
    headers: {
      'Content-Type': served.contentType,
      'Content-Length': String(served.body.length),
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': MEDIA_CSP,
      'Cross-Origin-Resource-Policy': 'same-origin',
    },
  });
}
