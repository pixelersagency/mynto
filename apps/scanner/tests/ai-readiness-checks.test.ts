import type { AiCheckId, AiCheckResult, AiCheckStatus } from '@mynto/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type * as SafeFetchModule from '../src/audit/collectors/safe-fetch.js';

/**
 * One test per Préparation IA check, against fixture sites. No network:
 * safeFetch (every probe of the audited site) is replaced by an in-memory
 * router, and the DNS-over-HTTPS lookup goes through a stubbed global fetch.
 */

interface Route {
  status?: number;
  type?: string;
  body?: string;
  headers?: Record<string, string>;
}
type Handler = Route | ((req: { accept: string; ua: string }) => Route);
type Site = Record<string, Handler>;

const requests: { url: string; accept: string; ua: string }[] = [];
let site: Site = {};

const safeFetchMock = vi.hoisted(() => vi.fn());

vi.mock('../src/audit/collectors/safe-fetch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof SafeFetchModule>();
  return { ...actual, safeFetch: safeFetchMock };
});

const { runAgentReadinessAudit, runAiReadiness } = await import(
  '../src/audit/ai-readiness/index.js'
);

function serve(url: string, init: RequestInit): ReturnType<typeof SafeFetchModule.safeFetch> {
  const headers = new Headers(init.headers);
  const req = { accept: headers.get('accept') ?? '', ua: headers.get('user-agent') ?? '' };
  requests.push({ url, ...req });
  const u = new URL(url);
  const handler = site[u.pathname];
  const route: Route =
    handler === undefined
      ? { status: 404, type: 'text/html', body: '<html><body>Not found</body></html>' }
      : typeof handler === 'function'
        ? handler(req)
        : handler;
  const response = new Response(route.body ?? '', {
    status: route.status ?? 200,
    headers: { 'content-type': route.type ?? 'text/html', ...(route.headers ?? {}) },
  });
  return Promise.resolve({ ok: true, response, finalUrl: url });
}

/** DoH answers by record name. `null` = resolver unreachable. */
let dns: Record<string, string[]> | null = {};

function stubDoh(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL) => {
      if (dns === null) return Promise.reject(new Error('offline'));
      const url = new URL(String(input));
      const name = url.searchParams.get('name') ?? '';
      const type = url.searchParams.get('type') ?? '';
      const records = dns[`${type} ${name}`] ?? [];
      return Promise.resolve(
        new Response(JSON.stringify({ Answer: records.map((data) => ({ data })) }), {
          status: 200,
          headers: { 'content-type': 'application/dns-json' },
        }),
      );
    }),
  );
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

const LONG_TEXT = Array.from({ length: 200 }, (_, i) => `mot${String(i)}`).join(' ');

/** A shop that publishes every standard: all 24 checks pass. */
function readySite(): Site {
  const home = `<!doctype html><html><head>
    <script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer"}}</script>
    </head><body><a href="/panier">Panier</a><main><p>${LONG_TEXT}</p></main>
    <script>navigator.modelContext.provideContext({ tools: [] })</script></body></html>`;
  return {
    '/': ({ accept }) =>
      accept === 'text/markdown'
        ? { type: 'text/markdown; charset=utf-8', body: '# Boutique\n\nBienvenue.' }
        : {
            body: home,
            headers: {
              link: '</index.md>; rel="alternate"; type="text/markdown"',
              'www-authenticate': 'Bearer resource_metadata="https://shop.example/.well-known/oauth-protected-resource"',
              'x-accept-payment': 'x402',
            },
          },
    '/robots.txt': {
      type: 'text/plain',
      body: [
        'User-agent: *',
        'Content-Signal: ai-train=no, search=yes, ai-input=yes',
        'Allow: /',
        '',
        'User-agent: GPTBot',
        'Allow: /',
        'User-agent: ClaudeBot',
        'Allow: /',
        'Sitemap: https://shop.example/sitemap.xml',
      ].join('\n'),
    },
    '/sitemap.xml': { type: 'application/xml', body: '<?xml version="1.0"?><urlset></urlset>' },
    '/llms.txt': {
      type: 'text/plain',
      body: '# Boutique\n\n> Ce que fait la boutique.\n\n- [Produits](https://shop.example/produits): catalogue',
    },
    '/.well-known/http-message-signatures-directory': {
      type: 'application/json',
      body: '{"keys":[]}',
    },
    '/.well-known/mcp/server-card.json': {
      type: 'application/json',
      body: '{"name":"shop","version":"1.0","url":"https://shop.example/mcp"}',
    },
    '/.well-known/agent-card.json': {
      type: 'application/json',
      body: '{"name":"shop","url":"https://shop.example/a2a","skills":[]}',
    },
    '/.well-known/agent-skills/index.json': {
      type: 'application/json',
      body: '{"skills":[{"name":"commander"}]}',
    },
    '/.well-known/api-catalog': {
      type: 'application/linkset+json',
      body: '{"linkset":[{"anchor":"https://shop.example/api","service-desc":[{"href":"/openapi.json"}]}]}',
    },
    '/.well-known/openid-configuration': {
      type: 'application/json',
      body: '{"issuer":"https://shop.example","authorization_endpoint":"/a","token_endpoint":"/t"}',
    },
    '/.well-known/oauth-protected-resource': {
      type: 'application/json',
      body: '{"resource":"https://shop.example","authorization_servers":["https://shop.example"]}',
    },
    '/auth.md': { type: 'text/markdown', body: '# Authentification\n\nOAuth 2.1.' },
    '/.well-known/ai-catalog.json': { type: 'application/json', body: '{"resources":[]}' },
    '/api': { status: 402, type: 'application/json', body: '{"x402":true,"accepts":[]}' },
    '/.well-known/mpp.json': { type: 'application/json', body: '{"merchant_payment":{}}' },
    '/.well-known/ucp': { type: 'application/json', body: '{"version":"1"}' },
    '/.well-known/acp.json': { type: 'application/json', body: '{"checkout":{}}' },
  };
}

/** A client-side rendered showcase site with nothing for agents. */
function bareSite(): Site {
  return {
    '/': {
      body: '<!doctype html><html><body><div id="root"></div><script src="/app.js"></script></body></html>',
    },
  };
}

function statusOf(checks: AiCheckResult[], id: AiCheckId): AiCheckStatus | undefined {
  return checks.find((c) => c.id === id)?.status;
}

async function audit(s: Site, type: 'auto' | 'vitrine' | 'contenu' | 'app_api' | 'ecommerce') {
  site = s;
  return runAgentReadinessAudit('https://shop.example/', logger, type);
}

beforeEach(() => {
  requests.length = 0;
  safeFetchMock.mockReset();
  safeFetchMock.mockImplementation(serve);
  dns = {
    'SVCB _index._agents.shop.example': ['1 agents.shop.example. alpn="h2"'],
  };
  stubDoh();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fixture site publishing every standard', () => {
  it('passes the 24 checks, scores 100 and reaches level 5 as a detected shop', async () => {
    const out = await audit(readySite(), 'auto');
    expect(out.checks).toHaveLength(24);
    const notPassing = out.checks.filter((c) => c.status !== 'pass').map((c) => c.id);
    expect(notPassing).toEqual([]);
    expect(out.score).toBe(100);
    expect(out.level).toBe(5);
    expect(out.siteType).toBe('ecommerce');
    expect(out.siteTypeAuto).toBe(true);
    expect(out.siteTypeSignals).toEqual(expect.arrayContaining(['schema:Product', 'panier']));
    // A passing check never carries a fix.
    expect(out.checks.every((c) => c.fixPrompt === undefined)).toBe(true);
  });

  it('identifies itself with the scanner User-Agent, and only simulates AI bots', async () => {
    await audit(readySite(), 'auto');
    const uas = new Set(requests.map((r) => r.ua));
    for (const ua of uas) {
      expect(ua).toMatch(/^Mozilla\/5\.0 \(compatible; MyntoAudit\//);
      expect(ua).not.toMatch(/^GPTBot|^ClaudeBot/);
    }
    expect([...uas].some((ua) => ua.endsWith('(simulating GPTBot)'))).toBe(true);
    expect([...uas].some((ua) => ua.endsWith('(simulating ClaudeBot)'))).toBe(true);
  });
});

describe('fixture site with nothing for agents', () => {
  it('fails every applicable check of a vitrine, out-of-scope ones are neutral', async () => {
    dns = {};
    const out = await audit(bareSite(), 'vitrine');
    const expectFail: AiCheckId[] = [
      'robots_txt',
      'sitemap',
      'link_headers',
      'dns_aid',
      'markdown_negotiation',
      'llms_txt',
      'no_js_content',
      'ai_bot_rules',
      'content_signals',
    ];
    for (const id of expectFail) expect([id, statusOf(out.checks, id)]).toEqual([id, 'fail']);
    // Optional standard: neutral, never a failure.
    expect(statusOf(out.checks, 'web_bot_auth')).toBe('neutral');
    // The page answers to the simulated bots: not blocked.
    expect(statusOf(out.checks, 'ai_bot_live_access')).toBe('pass');
    const outOfScope = out.checks.filter((c) => c.applicable === false).map((c) => c.id);
    expect(outOfScope).toEqual([
      'mcp_server_card',
      'a2a_agent_card',
      'agent_skills',
      'webmcp',
      'api_catalog',
      'oauth_discovery',
      'oauth_protected_resource',
      'auth_md',
      'ard_manifest',
      'x402',
      'mpp',
      'ucp',
      'acp',
    ]);
    expect(out.checks.filter((c) => c.applicable === false).every((c) => c.status === 'neutral')).toBe(
      true,
    );
    // Only ai_bot_live_access (weight 3) passes over 3+3+2+1+3+2+3+3+2+3 = 25.
    expect(out.score).toBe(12);
    expect(out.level).toBe(0);
    expect(out.maxLevel).toBe(3);
    // Out-of-scope standards are not even requested.
    expect(requests.some((r) => r.url.includes('/.well-known/mcp'))).toBe(false);
    // Each failure comes with a fix instruction.
    for (const id of expectFail) {
      expect(out.checks.find((c) => c.id === id)?.fixPrompt).toEqual(expect.any(String));
    }
  });

  it('fails the protocol and commerce checks of a shop that exposes none', async () => {
    dns = {};
    const out = await audit(bareSite(), 'ecommerce');
    for (const id of [
      'mcp_server_card',
      'a2a_agent_card',
      'agent_skills',
      'webmcp',
      'api_catalog',
      'oauth_discovery',
      'oauth_protected_resource',
      'auth_md',
      'ard_manifest',
      'x402',
      'mpp',
      'ucp',
      'acp',
    ] as const) {
      expect([id, statusOf(out.checks, id)]).toEqual([id, 'fail']);
    }
    expect(out.isCommerce).toBe(true);
  });
});

describe('individual checks', () => {
  it('robots_txt: HTML at /robots.txt is a disguised 404', async () => {
    const s = readySite();
    s['/robots.txt'] = { type: 'text/html', body: 'User-agent: *\nAllow: /' };
    const out = await audit(s, 'vitrine');
    expect(statusOf(out.checks, 'robots_txt')).toBe('fail');
    expect(out.checks.find((c) => c.id === 'robots_txt')?.message).toMatch(/HTML/);
  });

  it('sitemap: valid but undeclared still passes; a non-XML answer fails', async () => {
    const s = readySite();
    s['/robots.txt'] = { type: 'text/plain', body: 'User-agent: *\nAllow: /' };
    let out = await audit(s, 'vitrine');
    expect(out.checks.find((c) => c.id === 'sitemap')).toMatchObject({
      status: 'pass',
      message: expect.stringMatching(/non déclaré/) as unknown,
    });
    s['/sitemap.xml'] = { type: 'text/plain', body: 'pas un sitemap' };
    out = await audit(s, 'vitrine');
    expect(statusOf(out.checks, 'sitemap')).toBe('fail');
  });

  it('sitemap: an off-domain Sitemap directive is never fetched', async () => {
    const s = readySite();
    s['/robots.txt'] = {
      type: 'text/plain',
      body: 'User-agent: *\nSitemap: https://victime-tierce.example/lourd.xml',
    };
    await audit(s, 'vitrine');
    expect(requests.some((r) => r.url.includes('victime-tierce'))).toBe(false);
  });

  it('link_headers: a Link header without an agent relation fails', async () => {
    const s = readySite();
    s['/'] = { body: `<p>${LONG_TEXT}</p>`, headers: { link: '</style.css>; rel="preload"' } };
    const out = await audit(s, 'vitrine');
    expect(statusOf(out.checks, 'link_headers')).toBe('fail');
  });

  it('dns_aid: skipped (not failed) when the resolver is unreachable', async () => {
    dns = null;
    const out = await audit(readySite(), 'vitrine');
    expect(statusOf(out.checks, 'dns_aid')).toBe('skipped');
  });

  it('markdown_negotiation: the .md suffix counts too', async () => {
    const s = readySite();
    s['/'] = { body: `<p>${LONG_TEXT}</p>` };
    s['/index.md'] = { type: 'text/markdown', body: '# Accueil\n\nTexte.' };
    const out = await audit(s, 'vitrine');
    expect(out.checks.find((c) => c.id === 'markdown_negotiation')?.message).toMatch(/suffixe/);
    expect(statusOf(out.checks, 'markdown_negotiation')).toBe('pass');
  });

  it('llms_txt: present but unstructured passes with a warning; an HTML page fails', async () => {
    const s = readySite();
    s['/llms.txt'] = { type: 'text/plain', body: 'juste du texte' };
    let out = await audit(s, 'vitrine');
    expect(out.checks.find((c) => c.id === 'llms_txt')?.message).toMatch(/incomplet/);
    s['/llms.txt'] = { type: 'text/html', body: '<html>404</html>' };
    out = await audit(s, 'vitrine');
    expect(statusOf(out.checks, 'llms_txt')).toBe('fail');
  });

  it('no_js_content: counts words in the raw HTML only', async () => {
    const s = readySite();
    s['/'] = { body: `<script>${LONG_TEXT}</script><p>trois mots seulement</p>` };
    const out = await audit(s, 'vitrine');
    expect(out.checks.find((c) => c.id === 'no_js_content')?.message).toMatch(/^Seulement 3 mots/);
  });

  it('ai_bot_rules and content_signals: silence fails, explicit rules pass', async () => {
    const s = readySite();
    s['/robots.txt'] = { type: 'text/plain', body: 'User-agent: *\nDisallow: /admin' };
    const out = await audit(s, 'vitrine');
    expect(statusOf(out.checks, 'ai_bot_rules')).toBe('fail');
    expect(statusOf(out.checks, 'content_signals')).toBe('fail');
  });

  it('ai_bot_live_access: a WAF answering 403 to GPTBot fails', async () => {
    const s = readySite();
    const base = s['/'];
    s['/'] = (req) =>
      req.ua.includes('GPTBot')
        ? { status: 403, body: 'Forbidden' }
        : typeof base === 'function'
          ? base(req)
          : (base ?? {});
    const out = await audit(s, 'vitrine');
    const check = out.checks.find((c) => c.id === 'ai_bot_live_access');
    expect(check?.status).toBe('fail');
    expect(check?.message).toMatch(/GPTBot/);
    expect(check?.message).not.toMatch(/ClaudeBot/);
  });

  it('web_bot_auth: a published directory passes, absence stays neutral', async () => {
    const s = readySite();
    expect(statusOf((await audit(s, 'vitrine')).checks, 'web_bot_auth')).toBe('pass');
    delete s['/.well-known/http-message-signatures-directory'];
    expect(statusOf((await audit(s, 'vitrine')).checks, 'web_bot_auth')).toBe('neutral');
  });

  it('well-known JSON: an SPA shell answering 200 is not a document', async () => {
    const s = readySite();
    s['/.well-known/mcp/server-card.json'] = { body: '<!doctype html><div id="root"></div>' };
    const out = await audit(s, 'app_api');
    const check = out.checks.find((c) => c.id === 'mcp_server_card');
    expect(check?.status).toBe('fail');
    expect(check?.message).toMatch(/forme attendue/);
  });

  it('webmcp: markers in the page pass, none fail', async () => {
    const s = readySite();
    expect(statusOf((await audit(s, 'app_api')).checks, 'webmcp')).toBe('pass');
    s['/'] = { body: `<p>${LONG_TEXT}</p>` };
    expect(statusOf((await audit(s, 'app_api')).checks, 'webmcp')).toBe('fail');
  });

  it('oauth_protected_resource: the WWW-Authenticate header alone is enough', async () => {
    const s = readySite();
    delete s['/.well-known/oauth-protected-resource'];
    const out = await audit(s, 'app_api');
    expect(out.checks.find((c) => c.id === 'oauth_protected_resource')?.message).toMatch(
      /WWW-Authenticate/,
    );
  });

  it('api_catalog, auth_md, ard_manifest, oauth_discovery, a2a, agent_skills fail when absent', async () => {
    const removed = new Set([
      '/.well-known/api-catalog',
      '/auth.md',
      '/.well-known/ai-catalog.json',
      '/.well-known/openid-configuration',
      '/.well-known/agent-card.json',
      '/.well-known/agent-skills/index.json',
    ]);
    const s = Object.fromEntries(Object.entries(readySite()).filter(([p]) => !removed.has(p)));
    const out = await audit(s, 'app_api');
    for (const id of [
      'api_catalog',
      'auth_md',
      'ard_manifest',
      'oauth_discovery',
      'a2a_agent_card',
      'agent_skills',
    ] as const) {
      expect([id, statusOf(out.checks, id)]).toEqual([id, 'fail']);
    }
  });

  it('commerce checks: x402 by a 402 status, mpp, ucp and acp by their documents', async () => {
    const s = readySite();
    let out = await audit(s, 'ecommerce');
    for (const id of ['x402', 'mpp', 'ucp', 'acp'] as const) {
      expect(statusOf(out.checks, id)).toBe('pass');
    }
    delete s['/api'];
    s['/'] = { body: `<p>${LONG_TEXT}</p>` };
    delete s['/.well-known/mpp.json'];
    delete s['/.well-known/ucp'];
    s['/.well-known/acp.json'] = { type: 'text/html', body: '<html></html>' };
    out = await audit(s, 'ecommerce');
    for (const id of ['x402', 'mpp', 'ucp', 'acp'] as const) {
      expect([id, statusOf(out.checks, id)]).toEqual([id, 'fail']);
    }
  });
});

describe('site type', () => {
  it('a chosen type wins over the detection and is reported as chosen', async () => {
    const out = await audit(readySite(), 'vitrine');
    expect(out.siteType).toBe('vitrine');
    expect(out.siteTypeAuto).toBe(false);
    expect(out.siteTypeSignals).toEqual([]);
    expect(out.level).toBe(3);
  });

  it('auto falls back to vitrine on a page without signals', async () => {
    const out = await audit(bareSite(), 'auto');
    expect(out.siteType).toBe('vitrine');
    expect(out.siteTypeAuto).toBe(true);
  });
});

describe('runAiReadiness (pipeline entry point)', () => {
  it('stores a completed result with the 24 checks', async () => {
    site = readySite();
    const res = await runAiReadiness('https://shop.example/', logger, 'auto');
    expect(res).toMatchObject({
      version: 1,
      status: 'completed',
      score: 100,
      level: 5,
      site_type: 'ecommerce',
      included_in_global_score: false,
      error: null,
    });
    expect(res.checks).toHaveLength(24);
  });

  it('turns an unreachable origin into a failed result without score, never throws', async () => {
    safeFetchMock.mockImplementation(() =>
      Promise.resolve({ ok: false, kind: 'network_error', reason: 'ENOTFOUND' }),
    );
    const res = await runAiReadiness('https://shop.example/', logger, 'contenu');
    expect(res).toMatchObject({
      status: 'failed',
      score: null,
      level: null,
      site_type: 'contenu',
      site_type_auto: false,
      error: 'site_unreachable',
      checks: [],
    });
  });
});
