import { checkUrlSafe } from '../../lib/url-guard.js';
import type { DetectedStack, SitemapFacts } from '../types.js';

import { buildCandidates } from './resilient-paths.js';

const ROBOTS_TIMEOUT_MS = 5_000;
const SITEMAP_TIMEOUT_MS = 7_000;
const MAX_BYTES_ROBOTS = 256_000;
const MAX_BYTES_SITEMAP = 2_000_000;
const MAX_URLS_RETURNED = 200;
const MAX_INDEX_DEPTH = 1;
const MAX_INDEX_CHILDREN = 8;

interface DiscoverOptions {
  knownLinks?: string[];
  stack?: DetectedStack;
  userAgent: string;
}

/**
 * Multi-location, stack-aware sitemap discovery.
 *
 * Priority order:
 *   1. `Sitemap:` directives in /robots.txt (authoritative, RFC-defined)
 *   2. Stack-specific paths (e.g. /wp-sitemap.xml on WordPress)
 *   3. Conventional fallbacks (/sitemap.xml, /sitemap_index.xml, ...)
 *
 * Records every URL tried with status so the audit can flag a 404
 * specifically (not just "not found"), and the operator can investigate
 * stack misclassification.
 */
export async function discoverSitemap(
  origin: string,
  opts: DiscoverOptions,
): Promise<SitemapFacts> {
  const tried: SitemapFacts['triedLocations'] = [];

  const robotsResult = await fetchRobotsSitemaps(origin, opts.userAgent);
  const directiveCandidates = robotsResult.sitemaps;

  const fallbackCandidates = buildCandidates(origin, 'sitemap', {
    knownLinks: opts.knownLinks,
    stack: opts.stack,
  });

  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const list of [directiveCandidates, fallbackCandidates]) {
    for (const u of list) {
      const k = u.replace(/\/+$/, '').toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        ordered.push(u);
      }
    }
  }

  const collected = new Set<string>();
  let foundAt: string | null = null;

  for (const candidate of ordered) {
    if (collected.size >= MAX_URLS_RETURNED) break;
    const safe = await checkUrlSafe(candidate);
    if (!safe.ok) {
      tried.push({ url: candidate, status: 'error' });
      continue;
    }
    const fetched = await fetchSitemap(candidate, opts.userAgent);
    tried.push({ url: candidate, status: fetched.status });
    if (fetched.status === 200 && fetched.body) {
      foundAt ??= candidate;
      await harvestUrls(fetched.body, candidate, opts.userAgent, collected, 0);
    }
  }

  return {
    triedLocations: tried,
    found: foundAt !== null,
    foundAt,
    declaredInRobots: directiveCandidates.length > 0,
    urlsCount: collected.size,
    sampleUrls: [...collected].slice(0, 50),
  };
}

async function fetchRobotsSitemaps(
  origin: string,
  userAgent: string,
): Promise<{ sitemaps: string[] }> {
  const robotsUrl = `${origin}/robots.txt`;
  const safe = await checkUrlSafe(robotsUrl);
  if (!safe.ok) return { sitemaps: [] };
  const body = await fetchText(robotsUrl, ROBOTS_TIMEOUT_MS, MAX_BYTES_ROBOTS, userAgent);
  if (body === null) return { sitemaps: [] };
  const sitemaps: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    if (m && typeof m[1] === 'string') sitemaps.push(m[1]);
  }
  return { sitemaps };
}

async function fetchSitemap(
  url: string,
  userAgent: string,
): Promise<{ status: number | 'error' | 'timeout'; body: string | null }> {
  try {
    const body = await fetchText(url, SITEMAP_TIMEOUT_MS, MAX_BYTES_SITEMAP, userAgent);
    if (body === null) return { status: 404, body: null };
    return { status: 200, body };
  } catch (e) {
    if ((e as Error).name === 'AbortError') return { status: 'timeout', body: null };
    return { status: 'error', body: null };
  }
}

async function harvestUrls(
  body: string,
  smUrl: string,
  userAgent: string,
  out: Set<string>,
  depth: number,
): Promise<void> {
  const locs = extractLocs(body);
  const isIndex = /<sitemapindex[\s>]/i.test(body);

  if (isIndex && depth < MAX_INDEX_DEPTH) {
    let used = 0;
    for (const child of locs) {
      if (used >= MAX_INDEX_CHILDREN) break;
      if (out.size >= MAX_URLS_RETURNED) break;
      used += 1;
      const safe = await checkUrlSafe(child);
      if (!safe.ok) continue;
      const fetched = await fetchSitemap(child, userAgent);
      if (fetched.status === 200 && fetched.body) {
        await harvestUrls(fetched.body, child, userAgent, out, depth + 1);
      }
    }
    return;
  }

  const smOrigin = (() => {
    try {
      return new URL(smUrl).origin;
    } catch {
      return null;
    }
  })();

  for (const loc of locs) {
    if (out.size >= MAX_URLS_RETURNED) break;
    try {
      const parsed = new URL(loc, smUrl);
      if (smOrigin && parsed.origin !== smOrigin) continue;
      out.add(parsed.toString());
    } catch {
      // skip malformed loc
    }
  }
}

function extractLocs(xml: string): string[] {
  const locs: string[] = [];
  const re = /<loc>([\s\S]*?)<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1];
    if (typeof raw !== 'string') continue;
    const decoded = decodeEntities(raw.trim());
    if (decoded.length > 0) locs.push(decoded);
  }
  return locs;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

async function fetchText(
  url: string,
  timeoutMs: number,
  maxBytes: number,
  userAgent: string,
): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': userAgent, Accept: '*/*' },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf-8');
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
