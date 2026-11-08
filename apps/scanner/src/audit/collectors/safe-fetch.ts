import { isIP, type LookupFunction } from 'node:net';

import { Agent } from 'undici';

import { checkUrlSafe, isPrivateIP } from '../../lib/url-guard.js';

const MAX_REDIRECTS = 5;
const DEFAULT_MAX_BODY_BYTES = 2_000_000;

export interface SafeFetchResult {
  ok: true;
  response: Response;
  finalUrl: string;
}

/**
 * Why a fetch never produced a response.
 *
 * `unsafe_url` is the SSRF guard doing its job; `network_error` is our own
 * side failing (DNS, TLS, timeout, no outbound route). Keeping them apart
 * matters: for months every audit IA scored 0 because every probe failed,
 * and a bare `null` made it impossible to tell a blocked target from a
 * scanner that could not reach the internet at all.
 */
export type SafeFetchFailureKind =
  | 'unsafe_url'
  | 'network_error'
  | 'redirect_loop'
  | 'invalid_redirect';

export interface SafeFetchFailure {
  ok: false;
  kind: SafeFetchFailureKind;
  /** Short, log-friendly cause. Never rendered on a public report. */
  reason: string;
}

export type SafeFetchOutcome = SafeFetchResult | SafeFetchFailure;

/**
 * `fetch()` hardened against SSRF. Every hop is validated with
 * `checkUrlSafe` (protocol, port, private-IP, DNS resolution) and
 * redirects are followed *manually* so a 3xx pointing at localhost / a
 * private range / cloud metadata is rejected before the request is sent.
 *
 * The plain `fetch(redirect:'follow')` is unsafe here: the audited site
 * fully controls its own pages and can 3xx the scanner into the internal
 * network. Never throws: every failure comes back as a typed
 * `SafeFetchFailure` naming its cause.
 *
 * The address validated by `checkUrlSafe` is pinned down to the socket
 * through a per-request undici agent. Without that pin the name is
 * resolved a second time by `fetch`, and a hostile resolver answering
 * with a public address on the check and 127.0.0.1 / 169.254.169.254 on
 * the fetch (DNS rebinding, TTL 0) walks straight past the guard.
 */
export async function safeFetch(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
): Promise<SafeFetchOutcome> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const safe = await checkUrlSafe(current);
    if (!safe.ok) {
      return { ok: false, kind: 'unsafe_url', reason: safe.reason ?? 'unsafe_url' };
    }

    const agent = safe.resolvedIp === undefined ? null : pinnedAgent(safe.resolvedIp);
    // The agent is deliberately not closed here: the caller reads the body
    // after this function returns, and closing the dispatcher first would
    // cut that stream. Short keep-alive timeouts let its sockets die on
    // their own once the body is consumed.
    let res: Response;
    try {
      res = await fetchImpl(current, {
        ...init,
        redirect: 'manual',
        ...(agent === null ? {} : { dispatcher: agent }),
      } as RequestInit);
    } catch (err) {
      // Swallowing this upstream is what hid the outage: an aborted
      // request, a TLS failure and a missing outbound route all looked
      // alike. Report the cause instead of erasing it.
      return { ok: false, kind: 'network_error', reason: describeError(err) };
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) return { ok: true, response: res, finalUrl: current };
      try {
        current = new URL(location, current).toString();
      } catch {
        // The Location header is attacker-controlled and this string ends
        // up in logs and in audits_ai.error: keep it to printable ASCII so
        // it cannot smuggle ANSI escapes or bidi overrides into a viewer.
        const safeLocation = location.replace(/[^\x20-\x7e]/g, '.').slice(0, 120);
        return { ok: false, kind: 'invalid_redirect', reason: `bad_location:${safeLocation}` };
      }
      continue;
    }
    return { ok: true, response: res, finalUrl: current };
  }
  return { ok: false, kind: 'redirect_loop', reason: `over_${String(MAX_REDIRECTS)}_redirects` };
}

/**
 * Flattens an error and its `cause` into one short line. `fetch` reports
 * almost everything as "fetch failed" and puts the real cause (ENOTFOUND,
 * ECONNREFUSED, an invalid dispatcher...) one level down.
 */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err).slice(0, 200);
  const parts = [err.name, err.message];
  const cause: unknown = (err as { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    parts.push(typeof code === 'string' ? `${code}:${cause.message}` : cause.message);
  }
  return parts
    .filter((p) => typeof p === 'string' && p.length > 0)
    .join(' / ')
    .slice(0, 200);
}

/**
 * Agent whose DNS resolution is replaced by the single address already
 * validated for this hop. TLS still uses the original hostname for SNI
 * and certificate verification, so pinning does not weaken it.
 *
 * The callback has two shapes and both must be honoured. `autoSelectFamily`
 * is on by default since Node 20, and it calls the hook with `all: true`,
 * expecting an *array* of entries. Answering it with the single-address
 * form makes every connection die on `ERR_INVALID_IP_ADDRESS: undefined`,
 * which is exactly what took the audit IA down: every probe failed, so
 * every report scored 0 and declared healthy sites invisible.
 */
export function pinnedAgent(ip: string): Agent {
  const family = isIP(ip);
  return new Agent({
    keepAliveTimeout: 1_000,
    keepAliveMaxTimeout: 5_000,
    connect: {
      lookup: ((_hostname, options, callback): void => {
        if (options.all === true) {
          callback(null, [{ address: ip, family }]);
          return;
        }
        callback(null, ip, family);
      }) satisfies LookupFunction,
    },
  });
}

/**
 * Read a response body as text, capped at `maxBytes`. Prevents a hostile
 * page from forcing an unbounded download into memory.
 */
export async function readCappedText(
  response: Response,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    chunks.push(value);
    if (total >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return Buffer.concat(chunks).toString('utf-8');
}

/**
 * Cheap synchronous SSRF check for Playwright request interception. No DNS
 * lookup (route handlers fire for every subresource), so it catches direct
 * private-IP literals and internal hostnames only; full DNS validation
 * stays on the main navigation URL via `checkUrlSafe`.
 */
export function isBlockedRequestUrl(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  // Non-HTTP schemes (data:, blob:) are inert subresources — let them load.
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;

  let host = u.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.localhost')
  ) {
    return true;
  }
  return isIP(host) !== 0 && isPrivateIP(host);
}
