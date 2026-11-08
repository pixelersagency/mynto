import { checkUrlSafe } from '../../lib/url-guard.js';
import type { HttpFacts } from '../types.js';
import { auditUserAgent, hasCustomAuditUserAgent } from '../user-agent.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_BYTES_HTML = 4_000_000;
// UA navigateur réaliste : un UA "bot" explicite se fait renvoyer 403 par
// les WAF/anti-bot courants (OVH, Cloudflare, Sucuri), ce qui produit des
// audits faussement "site inaccessible" alors que le site marche pour les
// vrais visiteurs. On scanne donc avec l'UA Chrome stable, sauf si
// l'opérateur fixe AUDIT_USER_AGENT (il assume alors le risque de 403).
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36';
const USER_AGENT = hasCustomAuditUserAgent() ? auditUserAgent() : CHROME_USER_AGENT;

export interface HttpProbeResult {
  facts: HttpFacts;
  html: string;
  contentType: string;
}

/**
 * Single GET probe with redirect following and TTFB measurement.
 * Returns rendered HTML plus structural facts (headers, security flags).
 */
export async function probeUrl(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<HttpProbeResult> {
  const safe = await checkUrlSafe(url);
  if (!safe.ok) {
    throw new Error(`url_blocked:${safe.reason ?? 'unknown'}`);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const t0 = Date.now();
  let firstByteAt: number | null = null;

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.5',
      },
    });

    firstByteAt = Date.now();

    const reader = res.body?.getReader();
    if (!reader) throw new Error('no_body_stream');

    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES_HTML) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const html = Buffer.concat(chunks).toString('utf-8');

    const headers: Record<string, string> = {};
    res.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });

    const finalUrl = res.url || url;
    const parsedFinal = (() => {
      try {
        return new URL(finalUrl);
      } catch {
        return null;
      }
    })();

    const facts: HttpFacts = {
      finalUrl,
      status: res.status,
      redirectChain: finalUrl !== url ? [url, finalUrl] : [url],
      responseHeaders: headers,
      ttfbMs: firstByteAt ? firstByteAt - t0 : null,
      htmlBytes: total,
      isHttps: parsedFinal?.protocol === 'https:',
      hasHsts: typeof headers['strict-transport-security'] === 'string',
      hasCsp: typeof headers['content-security-policy'] === 'string',
    };

    return {
      facts,
      html,
      contentType: headers['content-type'] ?? '',
    };
  } finally {
    clearTimeout(timer);
  }
}

export const AUDIT_USER_AGENT = USER_AGENT;
