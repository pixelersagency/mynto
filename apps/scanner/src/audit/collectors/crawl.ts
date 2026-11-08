import type * as cheerio from 'cheerio';

import { checkUrlSafe } from '../../lib/url-guard.js';
import type { AuditFacts } from '../types.js';

import { AUDIT_USER_AGENT } from './http.js';

const INTERNAL_SAMPLE_TIMEOUT_MS = 10_000;
const INTERNAL_SAMPLE_BUDGET_MS = 25_000;
const MAX_BYTES_PAGE = 2_000_000;
const MAX_INTERNAL_PAGES = 5;

/**
 * Pull up to MAX_INTERNAL_PAGES same-origin links from the home HTML and
 * fetch each one (lightweight: just enough to compute "fake one-page"
 * detection and read meta on a sub-page).
 */
export async function fetchInternalSample(
  origin: string,
  $: cheerio.CheerioAPI,
  baseHtml: string,
): Promise<AuditFacts['internalPagesCrawled']> {
  const candidates: string[] = [];
  const seen = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    try {
      const u = new URL(href, origin);
      if (u.origin !== origin) return;
      const norm = `${u.origin}${u.pathname}`.replace(/\/$/, '') || origin;
      if (norm === origin) return;
      if (seen.has(norm)) return;
      seen.add(norm);
      candidates.push(norm);
    } catch {
      // skip
    }
  });

  // Prefer pages that look like they would differ from home (deeper paths).
  candidates.sort((a, b) => pathDepth(b) - pathDepth(a));

  const deadline = Date.now() + INTERNAL_SAMPLE_BUDGET_MS;
  const out: AuditFacts['internalPagesCrawled'] = [];
  const fingerprints = new Set<string>([fingerprintHtml(baseHtml)]);
  let allDuplicateOfHome = candidates.length > 0;

  for (const url of candidates) {
    if (out.length >= MAX_INTERNAL_PAGES) break;
    if (Date.now() > deadline) break;
    const safe = await checkUrlSafe(url);
    if (!safe.ok) continue;

    const res = await fetchTextWithStatus(url, INTERNAL_SAMPLE_TIMEOUT_MS, MAX_BYTES_PAGE);
    if (!res) continue;
    out.push({ url, status: res.status, bytes: res.bytes });

    if (res.status === 200 && res.body) {
      const fp = fingerprintHtml(res.body);
      if (!fingerprints.has(fp)) allDuplicateOfHome = false;
      fingerprints.add(fp);
    } else {
      allDuplicateOfHome = false;
    }
  }

  // Tag the home record with our fake-one-page conclusion via a side channel:
  // we don't carry it here but `runHomeProbe` will read it back through the
  // returned array length + fingerprints.
  (out as { fakeOnePage?: boolean } & typeof out).fakeOnePage =
    out.length >= 2 && allDuplicateOfHome;

  return out;
}

function pathDepth(u: string): number {
  try {
    return new URL(u).pathname.split('/').filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * Coarse content fingerprint: collapses whitespace, strips scripts/styles,
 * hashes the *whole* stripped document. Hashing only a leading slice used to
 * false-positive on server-rendered sites whose unique content starts below a
 * large shared header/nav.
 */
function fingerprintHtml(html: string): string {
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  let h = 2166136261;
  for (let i = 0; i < stripped.length; i += 1) {
    h ^= stripped.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

interface FetchResult {
  status: number;
  body: string;
  bytes: number;
}

async function fetchTextWithStatus(
  url: string,
  timeoutMs: number,
  maxBytes: number,
): Promise<FetchResult | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': AUDIT_USER_AGENT, Accept: 'text/html,*/*;q=0.8' },
    });
    const reader = res.body?.getReader();
    if (!reader) return { status: res.status, body: '', bytes: 0 };
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    return {
      status: res.status,
      body: Buffer.concat(chunks).toString('utf-8'),
      bytes: total,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
