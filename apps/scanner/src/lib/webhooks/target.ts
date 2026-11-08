import { isIP } from 'node:net';

import { webhookUrlProblem } from '@mynto/shared';

import { resolveHost } from '../dns-resolver.js';
import { isPrivateIP } from '../url-guard.js';

/**
 * SSRF guard of the webhook dispatcher, run before every attempt.
 *
 * Default: HTTPS only, and every address the name resolves to must be
 * public (no loopback, private, link-local, CGNAT, benchmark, multicast or
 * reserved range). The address that passed is then pinned to the socket
 * (pinnedAgent), so a DNS answer that changes between the check and the
 * connection (rebinding) cannot reach the internal network.
 *
 * WEBHOOKS_ALLOW_PRIVATE=1 lifts the address check and allows http, for a
 * self-hosted n8n on the same network. The resolved address is still pinned.
 */

export type LookupAll = (host: string) => Promise<{ address: string; family: number }[]>;

/** System resolver or DoH, per SCANNER_DNS_RESOLVER (see dns-resolver.ts). */
const defaultLookup: LookupAll = (host) => resolveHost(host);

function v4(ip: string): [number, number] | null {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return [p[0] ?? 0, p[1] ?? 0];
}

/** Private ranges of url-guard plus the reserved ones a webhook never targets. */
export function isBlockedWebhookIp(ip: string): boolean {
  if (isPrivateIP(ip)) return true;
  const family = isIP(ip);
  if (family === 4) {
    const ab = v4(ip);
    if (ab === null) return true;
    const [a, b] = ab;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmark 198.18/15
    if (a === 192 && b === 0) return true; // 192.0.0/24, 192.0.2/24
    if (a === 198 && b === 51) return true; // TEST-NET-2
    if (a === 203 && b === 0) return true; // TEST-NET-3
    return false;
  }
  if (family === 6) {
    const h = ip.toLowerCase();
    if (h.startsWith('ff')) return true; // multicast
    if (h.startsWith('2001:db8')) return true; // documentation
    if (h.startsWith('64:ff9b:')) return true; // NAT64, may embed a private v4
    if (h.startsWith('::ffff:')) return true; // mapped v4: checked by url-guard, refuse the rest
    return false;
  }
  return true;
}

export type WebhookTargetCheck = { ok: true; ip: string; url: URL } | { ok: false; reason: string };

export async function checkWebhookTarget(
  raw: string,
  opts: { allowPrivate: boolean; lookup?: LookupAll },
): Promise<WebhookTargetCheck> {
  const problem = webhookUrlProblem(raw, opts.allowPrivate);
  if (problem !== null) return { ok: false, reason: problem };
  const url = new URL(raw);
  let host = url.hostname;
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);

  if (isIP(host) !== 0) {
    if (!opts.allowPrivate && isBlockedWebhookIp(host))
      return { ok: false, reason: 'private_target' };
    return { ok: true, ip: host, url };
  }

  let addrs: { address: string; family: number }[];
  try {
    addrs = await (opts.lookup ?? defaultLookup)(host);
  } catch {
    return { ok: false, reason: 'dns_error' };
  }
  if (addrs.length === 0) return { ok: false, reason: 'dns_error' };
  if (!opts.allowPrivate && addrs.some((a) => isBlockedWebhookIp(a.address))) {
    return { ok: false, reason: 'private_target' };
  }
  const first = addrs[0];
  if (first === undefined) return { ok: false, reason: 'dns_error' };
  return { ok: true, ip: first.address, url };
}
