import 'server-only';

import { ImageResponse } from 'next/og';

import { RENDER_MAX_PX, containBox, imageSize } from './favicon';

/**
 * Square PNG rendering of the favicon sources (next/og, already used for the
 * OG images: no extra image dependency). A wide logo is fitted ("contain")
 * on a square canvas instead of being squashed by the browser.
 */

const renders = new Map<string, Promise<Buffer | null>>();
const CACHE_MAX = 8;
let defaultApple: Promise<Buffer> | null = null;

async function toBuffer(res: ImageResponse): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

/**
 * `bytes` (PNG or JPEG) fitted on a `size` square. `padding` is a ratio of
 * the size, `background` a CSS color (transparent by default). Returns null
 * when the image cannot be read or is too large to decode safely: the
 * caller then serves the original bytes.
 */
export async function containSquarePng(
  cacheKey: string,
  bytes: Uint8Array,
  contentType: 'image/png' | 'image/jpeg',
  opts: { size: number; padding?: number; background?: string },
): Promise<Buffer | null> {
  const dims = imageSize(bytes);
  if (dims === null || dims.width > RENDER_MAX_PX || dims.height > RENDER_MAX_PX) return null;
  const k = `${cacheKey}:${String(opts.size)}:${String(opts.padding ?? 0)}:${opts.background ?? ''}`;
  const hit = renders.get(k);
  if (hit !== undefined) return hit;

  const inner = Math.round(opts.size * (1 - 2 * (opts.padding ?? 0)));
  const box = containBox(dims.width, dims.height, inner);
  const src = `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`;
  // The promise is cached: concurrent requests share one render, and a
  // failure is remembered (null) instead of being retried on every hit.
  const pending = toBuffer(
    new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: opts.background ?? 'transparent',
        }}
      >
        <img src={src} alt="" width={box.width} height={box.height} />
      </div>,
      { width: opts.size, height: opts.size },
    ),
  ).catch(() => null);
  if (renders.size >= CACHE_MAX) {
    const oldest = renders.keys().next().value;
    if (oldest !== undefined) renders.delete(oldest);
  }
  renders.set(k, pending);
  return pending;
}

const BAR_HEIGHTS = [62, 92, 128];

/** Default Mynto touch icon (180 x 180), same bars as DEFAULT_ICON_SVG. */
export async function defaultAppleIconPng(): Promise<Buffer> {
  defaultApple ??= toBuffer(
    new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#1a1d2e',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
          gap: 12,
          padding: 30,
          borderRadius: 38,
        }}
      >
        {BAR_HEIGHTS.map((h, i) => (
          <div
            key={i}
            style={{
              width: 28,
              height: h,
              borderRadius: 8,
              background: 'linear-gradient(180deg, #ffffff 0%, #8a91a3 100%)',
            }}
          />
        ))}
      </div>,
      { width: 180, height: 180 },
    ),
  ).catch((err: unknown) => {
    defaultApple = null;
    throw err;
  });
  return defaultApple;
}
