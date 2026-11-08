import type { AiCheckId, AiSiteType } from '@mynto/shared';

import type { ProbeResult } from './probe.js';

/**
 * Which checks are worth running per site type.
 *
 * A brochure site has no API, no account and no checkout: reporting nine
 * protocol failures on it is noise, not a finding. Non-applicable checks
 * are reported as `neutral` and stay out of the score.
 */
const BASE_CHECKS: AiCheckId[] = [
  'robots_txt',
  'sitemap',
  'link_headers',
  'dns_aid',
  'markdown_negotiation',
  'llms_txt',
  'no_js_content',
  'ai_bot_rules',
  'content_signals',
  'web_bot_auth',
  'ai_bot_live_access',
];

const CONTENT_EXTRA: AiCheckId[] = ['agent_skills', 'ard_manifest'];

const APP_EXTRA: AiCheckId[] = [
  'mcp_server_card',
  'a2a_agent_card',
  'webmcp',
  'api_catalog',
  'oauth_discovery',
  'oauth_protected_resource',
  'auth_md',
];

const COMMERCE_EXTRA: AiCheckId[] = ['x402', 'mpp', 'ucp', 'acp'];

export const APPLICABLE_CHECKS: Record<AiSiteType, ReadonlySet<AiCheckId>> = {
  vitrine: new Set(BASE_CHECKS),
  contenu: new Set([...BASE_CHECKS, ...CONTENT_EXTRA]),
  app_api: new Set([...BASE_CHECKS, ...CONTENT_EXTRA, ...APP_EXTRA]),
  ecommerce: new Set([...BASE_CHECKS, ...CONTENT_EXTRA, ...APP_EXTRA, ...COMMERCE_EXTRA]),
};

export interface SiteTypeDetection {
  siteType: AiSiteType;
  /** Signals behind the guess, shown in the report. */
  signals: string[];
}

const COMMERCE_PATTERNS: { signal: string; test: RegExp }[] = [
  { signal: 'schema:Offer', test: /"@type"\s*:\s*"(Offer|AggregateOffer)"/i },
  { signal: 'schema:Product', test: /"@type"\s*:\s*"Product"/i },
  { signal: 'panier', test: /href="[^"]*\/(panier|cart|checkout|commande)\b/i },
  { signal: 'woocommerce', test: /woocommerce|add-to-cart/i },
  { signal: 'shopify', test: /cdn\.shopify\.com|shopify-features/i },
  { signal: 'prix', test: /(\d+[.,]\d{2})\s*(€|EUR)/ },
];

const APP_PATTERNS: { signal: string; test: RegExp }[] = [
  { signal: 'connexion', test: /href="[^"]*\/(login|connexion|signin|sign-in|app|dashboard)\b/i },
  { signal: 'inscription', test: /href="[^"]*\/(signup|sign-up|register|inscription|essai)\b/i },
  { signal: 'documentation API', test: /href="[^"]*\/(api|developers|developpeurs|docs\/api)\b/i },
  {
    signal: 'schema:SoftwareApplication',
    test: /"@type"\s*:\s*"(SoftwareApplication|WebApplication)"/i,
  },
];

const CONTENT_PATTERNS: { signal: string; test: RegExp }[] = [
  { signal: 'blog', test: /href="[^"]*\/(blog|articles|actualites|news|magazine)\b/i },
  { signal: 'schema:Article', test: /"@type"\s*:\s*"(Article|BlogPosting|NewsArticle)"/i },
  { signal: 'flux RSS', test: /type="application\/(rss|atom)\+xml"/i },
];

/**
 * Heuristic used when the visitor picked "détection automatique".
 *
 * Two independent signals are required per family so a lone "€" in a
 * footer or a single /login link cannot reclassify a brochure site. Ties
 * go down the ladder (ecommerce > app_api > contenu > vitrine) because a
 * wrong guess upward costs the visitor a page of irrelevant failures.
 */
export function detectSiteType(home: ProbeResult): SiteTypeDetection {
  if (!home.ok) return { siteType: 'vitrine', signals: [] };
  const html = home.body;

  const commerce = COMMERCE_PATTERNS.filter((p) => p.test.test(html)).map((p) => p.signal);
  if (commerce.length >= 2) return { siteType: 'ecommerce', signals: commerce };

  const app = APP_PATTERNS.filter((p) => p.test.test(html)).map((p) => p.signal);
  if (app.length >= 2) return { siteType: 'app_api', signals: app };

  const content = CONTENT_PATTERNS.filter((p) => p.test.test(html)).map((p) => p.signal);
  if (content.length >= 2) return { siteType: 'contenu', signals: content };

  return { siteType: 'vitrine', signals: [...commerce, ...app, ...content] };
}

export const __testables = { COMMERCE_PATTERNS, APP_PATTERNS, CONTENT_PATTERNS };
