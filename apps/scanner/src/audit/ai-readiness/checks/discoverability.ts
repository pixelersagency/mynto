import type { AiCheckResult } from '@mynto/shared';

import { readCappedText } from '../../collectors/safe-fetch.js';
import { probeFirstOk } from '../probe.js';
import { buildCheck, probeEvidence, type AiAuditContext } from '../types.js';

/**
 * Discoverability: can an agent find the machine-readable entry points of
 * the site at all (robots.txt, sitemap, Link headers, DNS records)?
 */
export async function runDiscoverabilityChecks(ctx: AiAuditContext): Promise<AiCheckResult[]> {
  const [robotsTxt, sitemap, linkHeaders, dnsAid] = await Promise.all([
    checkRobotsTxt(ctx),
    checkSitemap(ctx),
    Promise.resolve(checkLinkHeaders(ctx)),
    checkDnsAid(ctx),
  ]);
  return [robotsTxt, sitemap, linkHeaders, dnsAid];
}

const ROBOTS_FIX = [
  'Place un fichier robots.txt à la racine du domaine.',
  'Mets-y au moins un bloc User-agent, les règles Disallow utiles',
  'et une ligne Sitemap: https://ton-domaine/sitemap.xml.',
].join(' ');

function checkRobotsTxt(ctx: AiAuditContext): Promise<AiCheckResult> {
  const res = ctx.robots;
  const specUrls = ['https://www.rfc-editor.org/rfc/rfc9309.html'];

  if (!res.ok) {
    return Promise.resolve(
      buildCheck({
        id: 'robots_txt',
        status: 'fail',
        message:
          res.status === 'error'
            ? 'Le fichier robots.txt ne répond pas (erreur réseau ou blocage).'
            : `Pas de fichier robots.txt (HTTP ${String(res.status)}).`,
        evidence: [probeEvidence('GET /robots.txt', res)],
        specUrls,
        fixPrompt: ROBOTS_FIX,
      }),
    );
  }

  const hasDirective = /^\s*(user-agent|allow|disallow|sitemap)\s*:/im.test(res.body);
  if (!hasDirective) {
    return Promise.resolve(
      buildCheck({
        id: 'robots_txt',
        status: 'fail',
        message: 'Le fichier robots.txt répond, mais il ne contient aucune règle valide.',
        evidence: [probeEvidence('GET /robots.txt', res)],
        specUrls,
        fixPrompt: ROBOTS_FIX,
      }),
    );
  }

  // A page served as HTML at /robots.txt is a 404 page in disguise.
  if (res.contentType.includes('html')) {
    return Promise.resolve(
      buildCheck({
        id: 'robots_txt',
        status: 'fail',
        message: 'Le fichier robots.txt renvoie du HTML au lieu de texte brut : les robots l’ignorent.',
        evidence: [probeEvidence('GET /robots.txt', res)],
        specUrls,
        fixPrompt: `${ROBOTS_FIX} Sers-le en texte brut (Content-Type: text/plain).`,
      }),
    );
  }

  return Promise.resolve(
    buildCheck({
      id: 'robots_txt',
      status: 'pass',
      message: 'Fichier robots.txt présent et lisible.',
      evidence: [probeEvidence('GET /robots.txt', res)],
      specUrls,
    }),
  );
}

const SITEMAP_FIX = [
  'Génère un plan du site en XML avec toutes tes pages publiques,',
  'publie-le à l’adresse /sitemap.xml et signale-le dans robots.txt avec la ligne',
  'Sitemap: https://ton-domaine/sitemap.xml.',
].join(' ');

async function checkSitemap(ctx: AiAuditContext): Promise<AiCheckResult> {
  const specUrls = ['https://www.sitemaps.org/protocol.html'];
  const declared = ctx.robots.ok ? extractSitemapDirectives(ctx.robots.body, ctx.host) : [];
  const candidates = [
    ...declared,
    `${ctx.origin}/sitemap.xml`,
    `${ctx.origin}/sitemap_index.xml`,
    `${ctx.origin}/sitemap-index.xml`,
  ].slice(0, 5);

  const tried = await probeFirstOk(candidates, { accept: 'application/xml,text/xml,*/*' });
  const found = tried.find((r) => r.ok && /<(urlset|sitemapindex)/i.test(r.body));
  const evidence = tried.map((r) => probeEvidence('GET sitemap', r));

  if (!found) {
    const servedButInvalid = tried.some((r) => r.ok);
    return buildCheck({
      id: 'sitemap',
      status: 'fail',
      message: servedButInvalid
        ? 'Un fichier répond, mais ce n’est pas un plan du site valide (ni <urlset> ni <sitemapindex>).'
        : 'Pas de plan du site en XML.',
      evidence,
      specUrls,
      fixPrompt: SITEMAP_FIX,
    });
  }

  if (declared.length === 0) {
    return buildCheck({
      id: 'sitemap',
      status: 'pass',
      message: 'Plan du site valide, mais non déclaré dans robots.txt.',
      evidence,
      specUrls,
    });
  }

  return buildCheck({
    id: 'sitemap',
    status: 'pass',
    message: 'Plan du site valide et déclaré dans robots.txt.',
    evidence,
    specUrls,
  });
}

/**
 * Link headers matter to agents that never parse the HTML: they read the
 * response headers of a HEAD/GET and follow the relations from there.
 */
function checkLinkHeaders(ctx: AiAuditContext): AiCheckResult {
  const specUrls = [
    'https://www.rfc-editor.org/rfc/rfc8288.html',
    'https://developers.cloudflare.com/fundamentals/reference/markdown-for-agents/',
  ];
  const header = ctx.home.headers.link;
  const fixPrompt = [
    'Ajoute un en-tête HTTP Link à tes pages publiques pour indiquer aux agents où trouver leurs versions lisibles par une machine.',
    'Exemple : Link: </index.md>; rel="alternate"; type="text/markdown",',
    '</.well-known/mcp/server-card.json>; rel="service-desc".',
  ].join(' ');

  if (typeof header !== 'string' || header.length === 0) {
    return buildCheck({
      id: 'link_headers',
      status: 'fail',
      message: 'La page n’envoie aucun en-tête Link.',
      evidence: [probeEvidence('GET page cible', ctx.home)],
      specUrls,
      fixPrompt,
    });
  }

  const useful = ['alternate', 'describedby', 'service-desc', 'service-doc', 'api-catalog'].filter(
    (rel) => new RegExp(`rel\\s*=\\s*"?${rel}`, 'i').test(header),
  );

  if (useful.length === 0) {
    return buildCheck({
      id: 'link_headers',
      status: 'fail',
      message: 'La page envoie des en-têtes Link, mais aucun n’est utile à un agent.',
      evidence: [{ label: 'Link', url: ctx.home.url, detail: header.slice(0, 240) }],
      specUrls,
      fixPrompt,
    });
  }

  return buildCheck({
    id: 'link_headers',
    status: 'pass',
    message: `En-têtes Link utiles aux agents : ${useful.join(', ')}.`,
    evidence: [{ label: 'Link', url: ctx.home.url, detail: header.slice(0, 240) }],
    specUrls,
  });
}

const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query';
const DNS_AID_PREFIXES = ['_index._agents', '_mcp._agents', '_a2a._agents'] as const;

/**
 * DNS for AI Discovery. Queried over DoH rather than `node:dns` because
 * the spec's primary record types (SVCB/HTTPS) are not exposed by the
 * Node resolver. The resolver being unreachable yields `skipped`, never a
 * `fail` — a broken probe must not look like a broken site.
 */
async function checkDnsAid(ctx: AiAuditContext): Promise<AiCheckResult> {
  const specUrls = ['https://agenticresourcediscovery.org/'];
  const evidence: AiCheckResult['evidence'] = [];
  let resolverReached = false;
  let found = false;

  for (const prefix of DNS_AID_PREFIXES) {
    for (const type of ['SVCB', 'TXT'] as const) {
      const name = `${prefix}.${ctx.host}`;
      const answer = await queryDoh(name, type);
      if (answer === null) continue;
      resolverReached = true;
      evidence.push({
        label: `DNS ${type} ${name}`,
        status: answer.records.length > 0 ? 'trouvé' : 'aucun enregistrement',
        ...(answer.records.length > 0 ? { detail: answer.records.join(' | ').slice(0, 240) } : {}),
      });
      if (answer.records.length > 0) found = true;
    }
  }

  if (!resolverReached) {
    return buildCheck({
      id: 'dns_aid',
      status: 'skipped',
      message: 'Le résolveur DNS ne répond pas : test non concluant.',
      evidence,
      specUrls,
    });
  }

  if (!found) {
    return buildCheck({
      id: 'dns_aid',
      status: 'fail',
      message: 'Aucun enregistrement DNS _agents.',
      evidence,
      specUrls,
      fixPrompt: [
        'Ajoute des enregistrements DNS sous _agents.ton-domaine :',
        'un SVCB _index._agents qui pointe vers la liste de tes ressources pour agents,',
        'et un SVCB _mcp._agents vers ton serveur MCP si tu en as un.',
      ].join(' '),
    });
  }

  return buildCheck({
    id: 'dns_aid',
    status: 'pass',
    message: 'Enregistrements DNS _agents en place.',
    evidence,
    specUrls,
  });
}

interface DohAnswer {
  records: string[];
}

async function queryDoh(name: string, type: 'SVCB' | 'TXT'): Promise<DohAnswer | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, 4_000);
  try {
    const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: 'application/dns-json' },
    });
    if (!res.ok) return null;
    const raw = await readCappedText(res, 32_000);
    const body = JSON.parse(raw) as { Answer?: { data?: unknown }[] };
    const records = (body.Answer ?? [])
      .map((a) => a.data)
      .filter((d): d is string => typeof d === 'string')
      .map((d) => d.slice(0, 200));
    return { records };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sitemap directives, restricted to the audited host. robots.txt is
 * content the audited site controls, so an off-domain `Sitemap:` would
 * otherwise turn the scanner into a reflector aimed at a third party, and
 * republish that third party's bytes in our public evidence.
 */
function extractSitemapDirectives(robotsBody: string, host: string): string[] {
  const out: string[] = [];
  for (const line of robotsBody.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
    const value = match?.[1];
    if (value === undefined) continue;
    try {
      const parsed = new URL(value);
      const sameSite = parsed.hostname === host || parsed.hostname.endsWith(`.${host}`);
      if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && sameSite) {
        out.push(parsed.toString());
      }
    } catch {
      // relative or malformed Sitemap directive: ignored, the default
      // /sitemap.xml candidate below still covers the common case.
    }
    if (out.length >= 2) break;
  }
  return out;
}

export const __testables = { extractSitemapDirectives };
