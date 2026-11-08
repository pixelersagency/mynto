import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/**
 * Host name resolution used by the SSRF guards (url-guard, webhook target)
 * and therefore by IP pinning: the address that passes the guard is the
 * one the socket connects to.
 *
 * SCANNER_DNS_RESOLVER selects the source:
 *   - `system` (default): the OS resolver (`dns.lookup`, /etc/hosts and
 *     the configured DNS servers).
 *   - `doh`: DNS-over-HTTPS to Cloudflare (1.1.1.1, then 1.0.0.1) with
 *     Google (8.8.8.8) as fallback. Useful when the host's resolver is
 *     filtered or proxied (corporate DNS, VPN that answers every name with
 *     a fake 240.x address): the guard then sees the real public address.
 *
 * Security: the guards apply the full private / reserved blocklist to
 * whatever this module returns, DoH answers included. DoH only changes who
 * answers, never what is accepted. The DoH endpoints are IP literals, so
 * no bootstrap lookup goes through the system resolver.
 */

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type HostResolver = (host: string) => Promise<ResolvedAddress[]>;

export type DnsResolverMode = 'system' | 'doh';

export class DnsResolutionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'DnsResolutionError';
    this.code = code;
  }
}

export const DEFAULT_DOH_ENDPOINTS: readonly string[] = [
  'https://1.1.1.1/dns-query',
  'https://1.0.0.1/dns-query',
  'https://8.8.8.8/resolve',
];

const DOH_TIMEOUT_MS = 5_000;
const CACHE_MAX_ENTRIES = 1_000;
const CACHE_MAX_TTL_S = 300;
const CACHE_MIN_TTL_S = 5;

export function systemResolver(): HostResolver {
  return async (host) => {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    return addrs
      .filter((a) => a.family === 4 || a.family === 6)
      .map((a) => ({ address: a.address, family: a.family as 4 | 6 }));
  };
}

interface DohAnswer {
  type?: unknown;
  data?: unknown;
  TTL?: unknown;
}

interface DohJson {
  Status?: unknown;
  Answer?: unknown;
}

/** Parses one JSON DoH answer (RFC 8427-like format of Cloudflare and Google). */
export function parseDohAnswer(
  json: unknown,
  type: 1 | 28,
): { addresses: ResolvedAddress[]; ttl: number; nxdomain: boolean } {
  const body = (json ?? {}) as DohJson;
  if (typeof body.Status !== 'number') {
    throw new DnsResolutionError('EBADRESP', 'malformed DoH answer');
  }
  // 3 = NXDOMAIN: the name does not exist, a definitive answer.
  if (body.Status === 3) return { addresses: [], ttl: CACHE_MIN_TTL_S, nxdomain: true };
  if (body.Status !== 0) {
    throw new DnsResolutionError('ESERVFAIL', `DoH status ${String(body.Status)}`);
  }
  const answers = Array.isArray(body.Answer) ? (body.Answer as DohAnswer[]) : [];
  const family = type === 1 ? 4 : 6;
  const addresses: ResolvedAddress[] = [];
  let ttl = CACHE_MAX_TTL_S;
  for (const a of answers) {
    // CNAME and other records are skipped: the resolver already followed
    // the chain and appended the final A / AAAA records.
    if (a.type !== type || typeof a.data !== 'string') continue;
    if (isIP(a.data) !== family) continue;
    addresses.push({ address: a.data, family });
    if (typeof a.TTL === 'number' && a.TTL >= 0) ttl = Math.min(ttl, a.TTL);
  }
  return { addresses, ttl, nxdomain: false };
}

async function queryDoh(
  endpoint: string,
  host: string,
  type: 1 | 28,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ addresses: ResolvedAddress[]; ttl: number; nxdomain: boolean }> {
  const url = new URL(endpoint);
  url.searchParams.set('name', host);
  url.searchParams.set('type', type === 1 ? 'A' : 'AAAA');
  const res = await fetchImpl(url, {
    headers: { accept: 'application/dns-json' },
    redirect: 'error',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new DnsResolutionError('EBADRESP', `DoH HTTP ${String(res.status)}`);
  const text = await res.text();
  if (text.length > 64_000) throw new DnsResolutionError('EBADRESP', 'DoH answer too large');
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new DnsResolutionError('EBADRESP', 'DoH answer is not JSON');
  }
  return parseDohAnswer(json, type);
}

export function dohResolver(
  opts: {
    endpoints?: readonly string[];
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    now?: () => number;
  } = {},
): HostResolver {
  const endpoints = opts.endpoints ?? DEFAULT_DOH_ENDPOINTS;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DOH_TIMEOUT_MS;
  const now = opts.now ?? Date.now;
  // Small TTL-bounded cache: Playwright interception re-checks every
  // subresource URL, most of them on the same few hosts.
  const cache = new Map<string, { addresses: ResolvedAddress[]; expiresAt: number }>();

  return async (rawHost) => {
    const host = rawHost.toLowerCase().replace(/\.$/, '');
    const hit = cache.get(host);
    if (hit !== undefined && hit.expiresAt > now()) return hit.addresses;

    let lastError: unknown = null;
    for (const endpoint of endpoints) {
      try {
        const [a, aaaa] = await Promise.all([
          queryDoh(endpoint, host, 1, fetchImpl, timeoutMs),
          queryDoh(endpoint, host, 28, fetchImpl, timeoutMs),
        ]);
        const addresses = [...a.addresses, ...aaaa.addresses];
        if (addresses.length === 0) {
          throw new DnsResolutionError(
            'ENOTFOUND',
            a.nxdomain ? `${host}: NXDOMAIN` : `${host}: no A/AAAA record`,
          );
        }
        const ttl = Math.max(CACHE_MIN_TTL_S, Math.min(a.ttl, aaaa.ttl, CACHE_MAX_TTL_S));
        if (cache.size >= CACHE_MAX_ENTRIES) cache.clear();
        cache.set(host, { addresses, expiresAt: now() + ttl * 1000 });
        return addresses;
      } catch (err) {
        // A definitive "no such name" is not a reason to ask the next server.
        if (err instanceof DnsResolutionError && err.code === 'ENOTFOUND') throw err;
        lastError = err;
      }
    }
    const detail = lastError instanceof Error ? lastError.message : 'unknown';
    throw new DnsResolutionError('ETIMEOUT', `every DoH endpoint failed (${detail})`);
  };
}

export function resolverModeFromEnv(raw: string | undefined): DnsResolverMode {
  return raw?.trim().toLowerCase() === 'doh' ? 'doh' : 'system';
}

let active: HostResolver | null = null;
let override: HostResolver | null = null;

/**
 * Resolves a host name with the resolver chosen by SCANNER_DNS_RESOLVER
 * (read from the environment, so this module works without the full
 * scanner config, e.g. in unit tests and the CLI).
 */
export function resolveHost(host: string): Promise<ResolvedAddress[]> {
  if (override !== null) return override(host);
  active ??=
    resolverModeFromEnv(process.env.SCANNER_DNS_RESOLVER) === 'doh'
      ? dohResolver()
      : systemResolver();
  return active(host);
}

/** Tests only: replaces the resolver (null restores the configured one). */
export function setHostResolverForTests(resolver: HostResolver | null): void {
  override = resolver;
  active = null;
}
