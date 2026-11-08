import { isIP } from 'node:net';

import { resolveHost, type HostResolver } from './dns-resolver.js';

export interface UrlCheckResult {
  ok: boolean;
  reason?: string;
  normalized?: string;
  resolvedIp?: string;
}

const BLOCKED_PROTOCOLS = new Set(['file:', 'javascript:', 'data:', 'ftp:', 'ws:', 'wss:']);
const ALLOWED_PORTS = new Set([80, 443]);

function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts as [number, number, number, number];
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  if (a >= 224) return true; // multicast 224/4, reserved 240/4, broadcast
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0) return true; // 192.0.0/24 (IETF), 192.0.2/24 (TEST-NET-1)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmark 198.18/15
  if (a === 198 && b === 51 && parts[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && parts[2] === 113) return true; // TEST-NET-3
  return false;
}

function ipv4FromMapped(ip: string): string | null {
  const lower = ip.toLowerCase();
  if (!lower.startsWith('::ffff:')) return null;
  const rest = lower.slice(7);
  if (isIP(rest) === 4) return rest;
  const parts = rest.split(':');
  if (parts.length === 2) {
    const hex = parts[0];
    const hex2 = parts[1];
    if (
      typeof hex === 'string' &&
      typeof hex2 === 'string' &&
      /^[0-9a-f]{1,4}$/.test(hex) &&
      /^[0-9a-f]{1,4}$/.test(hex2)
    ) {
      const n1 = parseInt(hex, 16);
      const n2 = parseInt(hex2, 16);
      return `${String((n1 >> 8) & 0xff)}.${String(n1 & 0xff)}.${String((n2 >> 8) & 0xff)}.${String(n2 & 0xff)}`;
    }
  }
  return null;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  if (/^fe[89ab]/.test(lower)) return true; // link-local fe80::/10
  if (lower.startsWith('ff')) return true; // multicast
  if (lower.startsWith('2001:db8:') || lower === '2001:db8::') return true; // documentation
  if (lower.startsWith('64:ff9b:')) return true; // NAT64, may embed a private IPv4
  if (lower.startsWith('100::') || lower.startsWith('100:0:0:0:')) return true; // discard
  const mapped = ipv4FromMapped(lower);
  if (mapped !== null) return isPrivateIPv4(mapped);
  return false;
}

export function isPrivateIP(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) return isPrivateIPv6(ip);
  return false;
}

export function normalizeUrl(input: string): string | null {
  try {
    const u = new URL(input);
    u.hostname = u.hostname.toLowerCase();
    u.search = '';
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/') && u.pathname === '/') {
      s = s.slice(0, -1);
    }
    return s;
  } catch {
    return null;
  }
}

/**
 * SSRF guard: protocol, credentials, port, internal host names, then every
 * address the name resolves to must be public. `resolver` defaults to the
 * one chosen by SCANNER_DNS_RESOLVER (system or DoH, see dns-resolver.ts);
 * the blocklist applies to its answers either way.
 */
export async function checkUrlSafe(
  input: string,
  resolver: HostResolver = resolveHost,
): Promise<UrlCheckResult> {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  if (BLOCKED_PROTOCOLS.has(u.protocol)) {
    return { ok: false, reason: `blocked_protocol:${u.protocol}` };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: 'unsupported_protocol' };
  }

  if (u.username !== '' || u.password !== '') {
    return { ok: false, reason: 'auth_in_url' };
  }

  const port = u.port === '' ? (u.protocol === 'https:' ? 443 : 80) : Number(u.port);
  if (!ALLOWED_PORTS.has(port)) {
    return { ok: false, reason: `blocked_port:${String(port)}` };
  }

  let host = u.hostname;
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1);
  }

  const suspiciousSuffix = ['.local', '.internal', '.localhost'];
  if (suspiciousSuffix.some((s) => host.endsWith(s)) || host === 'localhost') {
    return { ok: false, reason: 'blocked_hostname' };
  }

  if (isIP(host) !== 0) {
    if (isPrivateIP(host)) {
      return { ok: false, reason: 'private_ip_literal' };
    }
    return { ok: true, normalized: input, resolvedIp: host };
  }

  try {
    const addrs = await resolver(host);
    if (addrs.length === 0) {
      return { ok: false, reason: 'dns_no_answer' };
    }
    for (const a of addrs) {
      if (isPrivateIP(a.address)) {
        return { ok: false, reason: `private_ip_resolved:${a.address}` };
      }
    }
    return { ok: true, normalized: input, resolvedIp: addrs[0]?.address };
  } catch (err) {
    return { ok: false, reason: `dns_error:${(err as Error).message}` };
  }
}

/** Lowercased host of a URL (with port when non-default), or null if unparsable. */
export function extractDomain(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}
