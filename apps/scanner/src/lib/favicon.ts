import { getMediaStorage, isUuid } from '@mynto/db/media';

import { readCappedText, safeFetch } from '../audit/collectors/safe-fetch.js';
import { auditUserAgent } from '../audit/user-agent.js';
import { logger } from '../logger.js';

import { iconCandidates, sniffIcon } from './favicon-parse.js';

/**
 * Site favicon for the dashboard (identity of the audits). Best-effort:
 * the <link rel=icon> of the home page, else /favicon.ico. Every request
 * goes through safeFetch (SSRF guard, pinned IP). Only raster formats are
 * kept (PNG, ICO, JPEG, GIF, WebP), checked by magic bytes: an SVG served
 * from our origin could carry script. Capped at 100 KB.
 */

const MAX_ICON_BYTES = 100 * 1024;
const TIMEOUT_MS = 6_000;

async function fetchBytes(url: string, accept: string): Promise<Uint8Array | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      headers: { 'user-agent': auditUserAgent(), accept },
      signal: ctrl.signal,
    });
    if (!res.ok || !res.response.ok) return null;
    const reader = res.response.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ICON_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return new Uint8Array(Buffer.concat(chunks));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Fetches and stores the favicon of `url`. Returns the media key or null. */
export async function captureAndStoreFavicon(auditId: string, url: string): Promise<string | null> {
  if (!isUuid(auditId)) return null;
  let html = '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, TIMEOUT_MS);
  try {
    const res = await safeFetch(url, {
      headers: { 'user-agent': auditUserAgent(), accept: 'text/html' },
      signal: ctrl.signal,
    });
    if (res.ok) html = await readCappedText(res.response, 300_000);
  } catch {
    html = '';
  } finally {
    clearTimeout(timer);
  }
  for (const candidate of iconCandidates(html, url)) {
    const bytes = await fetchBytes(candidate, 'image/*');
    if (bytes === null) continue;
    const ext = sniffIcon(bytes);
    if (ext === null) continue;
    const key = `favicon/${auditId.toLowerCase()}.${ext}`;
    try {
      await getMediaStorage().put(key, Buffer.from(bytes), `image/${ext}`);
      return key;
    } catch (err) {
      logger.warn(
        { message: err instanceof Error ? err.message : 'unknown' },
        'favicon_store_failed',
      );
      return null;
    }
  }
  return null;
}
