import { describe, expect, it, vi } from 'vitest';

import {
  DnsResolutionError,
  dohResolver,
  parseDohAnswer,
  resolverModeFromEnv,
  type HostResolver,
} from '../src/lib/dns-resolver.js';
import { checkUrlSafe } from '../src/lib/url-guard.js';
import { checkWebhookTarget } from '../src/lib/webhooks/target.js';

function dohJson(answers: { type: number; data: string; TTL?: number }[], status = 0): Response {
  return new Response(JSON.stringify({ Status: status, Answer: answers }), {
    status: 200,
    headers: { 'content-type': 'application/dns-json' },
  });
}

/** Fake DoH server: A and AAAA answers per host, keyed by the `type` query param. */
function fakeDoh(table: Record<string, { A?: string[]; AAAA?: string[]; cname?: string }>) {
  return vi.fn((input: URL | string) => {
    const url = new URL(String(input));
    const name = url.searchParams.get('name') ?? '';
    const type = url.searchParams.get('type');
    const entry = table[name];
    if (entry === undefined) return Promise.resolve(dohJson([], 3));
    const list = type === 'A' ? (entry.A ?? []) : (entry.AAAA ?? []);
    const answers = [
      ...(entry.cname ? [{ type: 5, data: entry.cname, TTL: 60 }] : []),
      ...list.map((data) => ({ type: type === 'A' ? 1 : 28, data, TTL: 120 })),
    ];
    return Promise.resolve(dohJson(answers));
  });
}

describe('parseDohAnswer', () => {
  it('keeps A records, skips CNAME and malformed data', () => {
    const r = parseDohAnswer(
      {
        Status: 0,
        Answer: [
          { type: 5, data: 'edge.example.net.', TTL: 30 },
          { type: 1, data: '93.184.215.14', TTL: 60 },
          { type: 1, data: 'not-an-ip', TTL: 60 },
          { type: 28, data: '2606:2800::1', TTL: 60 },
        ],
      },
      1,
    );
    expect(r.addresses).toEqual([{ address: '93.184.215.14', family: 4 }]);
    expect(r.ttl).toBe(60);
    expect(r.nxdomain).toBe(false);
  });

  it('reports NXDOMAIN and refuses a malformed body', () => {
    expect(parseDohAnswer({ Status: 3 }, 1).nxdomain).toBe(true);
    expect(() => parseDohAnswer({ nope: true }, 1)).toThrow(DnsResolutionError);
    expect(() => parseDohAnswer({ Status: 2 }, 28)).toThrow(/status 2/);
  });
});

describe('dohResolver', () => {
  it('returns A and AAAA addresses following the CNAME chain', async () => {
    const fetchImpl = fakeDoh({
      'www.example.org': {
        cname: 'example.org.cdn.net.',
        A: ['93.184.215.14'],
        AAAA: ['2606:2800::1'],
      },
    });
    const resolve = dohResolver({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(resolve('WWW.Example.org.')).resolves.toEqual([
      { address: '93.184.215.14', family: 4 },
      { address: '2606:2800::1', family: 6 },
    ]);
    // Asked over HTTPS to an IP literal, JSON format.
    const first = new URL(String(fetchImpl.mock.calls[0]?.[0]));
    expect(first.protocol).toBe('https:');
    expect(first.hostname).toBe('1.1.1.1');
  });

  it('caches answers within their TTL', async () => {
    let t = 0;
    const fetchImpl = fakeDoh({ 'a.example': { A: ['93.184.215.14'] } });
    const resolve = dohResolver({
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => t,
    });
    await resolve('a.example');
    await resolve('a.example');
    expect(fetchImpl).toHaveBeenCalledTimes(2); // one A + one AAAA query
    t = 121_000;
    await resolve('a.example');
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('falls back to the next endpoint when one fails', async () => {
    const good = fakeDoh({ 'b.example': { A: ['93.184.215.14'] } });
    const fetchImpl = vi.fn((input: URL | string) => {
      if (new URL(String(input)).hostname === '1.1.1.1') {
        return Promise.reject(new TypeError('fetch failed'));
      }
      return good(input);
    });
    const resolve = dohResolver({
      endpoints: ['https://1.1.1.1/dns-query', 'https://8.8.8.8/resolve'],
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(resolve('b.example')).resolves.toEqual([{ address: '93.184.215.14', family: 4 }]);
  });

  it('fails with ENOTFOUND on NXDOMAIN without asking the other endpoints', async () => {
    const fetchImpl = fakeDoh({});
    const resolve = dohResolver({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(resolve('nope.example')).rejects.toMatchObject({ code: 'ENOTFOUND' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('fails when every endpoint is down', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('busy', { status: 503 })));
    const resolve = dohResolver({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(resolve('c.example')).rejects.toMatchObject({ code: 'ETIMEOUT' });
  });
});

describe('SSRF guards with DoH answers', () => {
  const resolverFor = (table: Record<string, { A?: string[]; AAAA?: string[] }>): HostResolver =>
    dohResolver({ fetchImpl: fakeDoh(table) as unknown as typeof fetch });

  it('accepts a public answer and pins it', async () => {
    const r = await checkUrlSafe(
      'https://public.example/',
      resolverFor({ 'public.example': { A: ['93.184.215.14'] } }),
    );
    expect(r).toMatchObject({ ok: true, resolvedIp: '93.184.215.14' });
  });

  it.each([
    ['127.0.0.1'],
    ['10.1.2.3'],
    ['169.254.169.254'],
    ['100.64.0.1'],
    ['198.18.0.1'],
    ['240.0.3.108'],
    ['192.0.2.10'],
  ])('rejects a DoH answer in a private or reserved range (%s)', async (ip) => {
    const r = await checkUrlSafe(
      'https://rebind.example/',
      resolverFor({ 'rebind.example': { A: ['93.184.215.14', ip] } }),
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(`private_ip_resolved:${ip}`);
  });

  it.each([['::1'], ['fd00::1'], ['fe80::1'], ['::ffff:10.0.0.1'], ['64:ff9b::a00:1']])(
    'rejects a private IPv6 answer (%s)',
    async (ip) => {
      const r = await checkUrlSafe(
        'https://v6.example/',
        resolverFor({ 'v6.example': { A: ['93.184.215.14'], AAAA: [ip] } }),
      );
      expect(r.ok).toBe(false);
    },
  );

  it('webhook target: DoH answers go through the same blocklist', async () => {
    const lookup = resolverFor({ 'hooks.example': { A: ['10.0.0.5'] } });
    await expect(
      checkWebhookTarget('https://hooks.example/x', { allowPrivate: false, lookup }),
    ).resolves.toEqual({ ok: false, reason: 'private_target' });
  });
});

describe('resolverModeFromEnv', () => {
  it('defaults to system', () => {
    expect(resolverModeFromEnv(undefined)).toBe('system');
    expect(resolverModeFromEnv('')).toBe('system');
    expect(resolverModeFromEnv('system')).toBe('system');
    expect(resolverModeFromEnv(' DoH ')).toBe('doh');
  });
});
