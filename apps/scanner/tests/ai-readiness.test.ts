import type { AiCheckId, AiCheckResult, AiCheckStatus } from '@mynto/shared';
import { describe, expect, it } from 'vitest';

import { __testables as botTestables } from '../src/audit/ai-readiness/checks/bots.js';
import { __testables as contentTestables } from '../src/audit/ai-readiness/checks/content.js';
import { __testables as discoTestables } from '../src/audit/ai-readiness/checks/discoverability.js';
import { __testables as protocolTestables } from '../src/audit/ai-readiness/checks/protocols.js';
import { computeLevel, computeScore } from '../src/audit/ai-readiness/scoring.js';
import { APPLICABLE_CHECKS, detectSiteType } from '../src/audit/ai-readiness/site-type.js';
import { CHECK_CATEGORY, CHECK_WEIGHTS } from '../src/audit/ai-readiness/types.js';

function check(id: AiCheckId, status: AiCheckStatus): AiCheckResult {
  return {
    id,
    category: CHECK_CATEGORY[id],
    status,
    message: '',
    evidence: [],
    specUrls: [],
    weight: CHECK_WEIGHTS[id],
  };
}

describe('computeScore', () => {
  it('is the weighted share of passing checks', () => {
    // robots_txt weight 3 passes, link_headers weight 2 fails -> 3/5.
    const score = computeScore([check('robots_txt', 'pass'), check('link_headers', 'fail')]);
    expect(score).toBe(60);
  });

  it('excludes neutral, skipped and zero-weight checks from the denominator', () => {
    const score = computeScore([
      check('robots_txt', 'pass'),
      check('x402', 'neutral'),
      check('dns_aid', 'skipped'),
      check('web_bot_auth', 'pass'),
    ]);
    expect(score).toBe(100);
  });

  it('returns 0 when nothing was applicable', () => {
    expect(computeScore([check('x402', 'neutral')])).toBe(0);
  });
});

describe('computeLevel', () => {
  it('stays at 0 when the baseline is missing', () => {
    const outcome = computeLevel([check('robots_txt', 'fail'), check('sitemap', 'pass')]);
    expect(outcome.level).toBe(0);
    expect(outcome.blocking).toContain('robots_txt');
  });

  it('reaches level 1 on robots + sitemap', () => {
    const outcome = computeLevel([check('robots_txt', 'pass'), check('sitemap', 'pass')]);
    expect(outcome.level).toBe(1);
    expect(outcome.levelName).toBe('Présence de base');
    expect(outcome.blocking).toEqual(['ai_bot_rules', 'content_signals']);
  });

  it('does not skip a level even when a higher one is satisfied', () => {
    const outcome = computeLevel([
      check('robots_txt', 'pass'),
      check('sitemap', 'pass'),
      check('mcp_server_card', 'pass'),
    ]);
    expect(outcome.level).toBe(1);
  });

  it('reaches level 3 with either markdown or llms.txt', () => {
    const base = [
      check('robots_txt', 'pass'),
      check('sitemap', 'pass'),
      check('ai_bot_rules', 'pass'),
      check('content_signals', 'pass'),
      check('no_js_content', 'pass'),
      check('ai_bot_live_access', 'pass'),
    ];
    expect(computeLevel([...base, check('llms_txt', 'pass')]).level).toBe(3);
    expect(computeLevel([...base, check('markdown_negotiation', 'pass')]).level).toBe(3);
    expect(computeLevel(base).level).toBe(2);
  });
});

describe('robots parsing', () => {
  it('collects declared user-agents lowercased, comments stripped', () => {
    const agents = botTestables.declaredUserAgents(
      'User-agent: GPTBot  # openai\nAllow: /\n\nuser-agent: *\nDisallow: /api/\n',
    );
    expect(agents).toEqual(['gptbot', '*']);
  });

  it('treats 403 and 429 as a block but a network error as unknown', () => {
    expect(botTestables.isBlocked(403)).toBe(true);
    expect(botTestables.isBlocked(429)).toBe(true);
    expect(botTestables.isBlocked(200)).toBe(false);
    expect(botTestables.isBlocked('error')).toBe(false);
  });

  it('keeps only absolute http(s) sitemap directives on the audited host', () => {
    const found = discoTestables.extractSitemapDirectives(
      [
        'Sitemap: https://example.com/sitemap.xml',
        'Sitemap: https://cdn.example.com/sitemap.xml',
        'Sitemap: /relative.xml',
        'Sitemap: https://victime-tierce.example/lourd.xml',
      ].join('\n'),
      'example.com',
    );
    expect(found).toEqual([
      'https://example.com/sitemap.xml',
      'https://cdn.example.com/sitemap.xml',
    ]);
  });
});

describe('content heuristics', () => {
  it('ignores script and style content when counting words', () => {
    const html =
      '<html><head><style>body{color:red}</style></head><body><script>var a = 1;</script><p>Bonjour tout le monde</p></body></html>';
    expect(contentTestables.countVisibleWords(html)).toBe(4);
  });

  it('does not take an HTML response for markdown', () => {
    expect(
      contentTestables.isMarkdown({ ok: true, contentType: 'text/html', body: '# Titre' }),
    ).toBe(false);
    expect(
      contentTestables.isMarkdown({ ok: true, contentType: 'text/markdown', body: '# Titre' }),
    ).toBe(true);
  });

  it('derives .md candidates from the target path', () => {
    expect(contentTestables.markdownSuffixCandidates('https://example.com/')).toEqual([
      'https://example.com/index.md',
    ]);
    expect(contentTestables.markdownSuffixCandidates('https://example.com/docs/')).toEqual([
      'https://example.com/docs.md',
      'https://example.com/docs/index.md',
    ]);
  });
});

describe('well-known document validation', () => {
  const base = { url: '', status: 200, ok: true, headers: {}, preview: '' };

  it('rejects an SPA shell served on a well-known path', () => {
    expect(
      protocolTestables.hasAnyKey(
        { ...base, contentType: 'text/html', body: '<!doctype html><div id="root"></div>' },
        ['name'],
      ),
    ).toBe(false);
  });

  it('accepts a JSON document carrying one of the expected keys', () => {
    expect(
      protocolTestables.hasAnyKey(
        { ...base, contentType: 'application/json', body: '{"name":"demo","url":"https://x"}' },
        ['name', 'version'],
      ),
    ).toBe(true);
  });

  it('rejects valid JSON without any expected key', () => {
    expect(
      protocolTestables.hasAnyKey({ ...base, contentType: 'application/json', body: '{"foo":1}' }, [
        'name',
      ]),
    ).toBe(false);
  });
});

describe('site type detection', () => {
  const probe = (body: string) => ({
    url: 'https://example.com',
    status: 200 as const,
    ok: true,
    contentType: 'text/html',
    headers: {},
    body,
    preview: '',
  });

  it('falls back to vitrine on a single weak signal', () => {
    expect(detectSiteType(probe('<p>À partir de 19,90 €</p>')).siteType).toBe('vitrine');
  });

  it('classifies a shop on two independent commerce signals', () => {
    const html =
      '<script type="application/ld+json">{"@type":"Product"}</script><a href="/panier">Panier</a>';
    expect(detectSiteType(probe(html)).siteType).toBe('ecommerce');
  });

  it('classifies an app on login plus signup links', () => {
    const html = '<a href="/login">Connexion</a><a href="/signup">Essai gratuit</a>';
    expect(detectSiteType(probe(html)).siteType).toBe('app_api');
  });

  it('classifies a content site on blog plus RSS', () => {
    const html =
      '<a href="/blog">Blog</a><link rel="alternate" type="application/rss+xml" href="/rss" />';
    expect(detectSiteType(probe(html)).siteType).toBe('contenu');
  });

  it('treats an unreachable home page as a vitrine', () => {
    expect(detectSiteType({ ...probe(''), ok: false, status: 'error' }).siteType).toBe('vitrine');
  });
});

describe('check applicability', () => {
  it('spares a vitrine the API, auth and commerce checks', () => {
    const vitrine = APPLICABLE_CHECKS.vitrine;
    expect(vitrine.has('robots_txt')).toBe(true);
    expect(vitrine.has('llms_txt')).toBe(true);
    expect(vitrine.has('mcp_server_card')).toBe(false);
    expect(vitrine.has('oauth_discovery')).toBe(false);
    expect(vitrine.has('acp')).toBe(false);
  });

  it('opens commerce checks only for an ecommerce site', () => {
    expect(APPLICABLE_CHECKS.app_api.has('x402')).toBe(false);
    expect(APPLICABLE_CHECKS.ecommerce.has('x402')).toBe(true);
  });
});

describe('level ceiling per site type', () => {
  const fullyReady = [
    check('robots_txt', 'pass'),
    check('sitemap', 'pass'),
    check('ai_bot_rules', 'pass'),
    check('content_signals', 'pass'),
    check('no_js_content', 'pass'),
    check('ai_bot_live_access', 'pass'),
    check('llms_txt', 'pass'),
    check('mcp_server_card', 'pass'),
  ];

  it('caps a vitrine at level 3 and stops asking for more', () => {
    const outcome = computeLevel(fullyReady, 3);
    expect(outcome.level).toBe(3);
    expect(outcome.blocking).toEqual([]);
  });

  it('lets an app reach level 4', () => {
    expect(computeLevel(fullyReady, 4).level).toBe(4);
  });
});
