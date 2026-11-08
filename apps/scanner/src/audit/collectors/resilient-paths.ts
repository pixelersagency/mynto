import type { DetectedStack } from '../types.js';

import { safeFetch } from './safe-fetch.js';

/**
 * Resilient discovery of conventional pages.
 *
 * Why this exists: a "sitemap" is not always at /sitemap.xml. Wordpress
 * exposes /wp-sitemap.xml, Yoast/RankMath split into /sitemap_index.xml.
 * Same problem for legal pages (/privacy vs /confidentialite vs
 * /donnees-personnelles), contact (/contact vs /nous-contacter), pricing
 * (/pricing vs /tarifs vs /#pricing). Single-path probing misses real pages.
 *
 * Strategy: per known path category, build a stack-aware ordered candidate
 * list. Caller HEAD/GETs each in order, takes first 2xx as the canonical
 * location, falls back to null if nothing matches.
 */

export type PathCategory =
  | 'sitemap'
  | 'robots'
  | 'mentions_legales'
  | 'privacy'
  | 'cgv'
  | 'dpa'
  | 'cookies_policy'
  | 'contact'
  | 'pricing'
  | 'about'
  | 'blog'
  | 'faq'
  | 'careers';

interface CandidateRule {
  paths: string[];
  stackBoost?: DetectedStack[];
}

const BASE_CANDIDATES: Record<PathCategory, string[]> = {
  sitemap: [
    '/sitemap.xml',
    '/sitemap_index.xml',
    '/sitemap-index.xml',
    '/sitemap.xml.gz',
    '/sitemaps.xml',
    '/sitemap/sitemap.xml',
    '/sitemap1.xml',
    '/post-sitemap.xml',
    '/page-sitemap.xml',
  ],
  robots: ['/robots.txt'],
  mentions_legales: [
    '/mentions-legales',
    '/mentions',
    '/mentions-legales/',
    '/legal',
    '/legal-notice',
    '/legal-notices',
    '/imprint',
    '/impressum',
    '/fr/mentions-legales',
    '/en/legal',
    '/legales',
  ],
  privacy: [
    '/privacy',
    '/privacy-policy',
    '/politique-de-confidentialite',
    '/politique-confidentialite',
    '/confidentialite',
    '/donnees-personnelles',
    '/protection-des-donnees',
    '/rgpd',
    '/gdpr',
    '/datenschutz',
    '/fr/confidentialite',
    '/en/privacy',
  ],
  cgv: [
    '/cgv',
    '/cgu',
    '/cgv-cgu',
    '/conditions-generales',
    '/conditions-generales-vente',
    '/conditions-generales-utilisation',
    '/conditions-utilisation',
    '/terms',
    '/terms-of-service',
    '/terms-of-use',
    '/tos',
    '/fr/cgv',
    '/en/terms',
  ],
  dpa: ['/dpa', '/data-processing-agreement', '/accord-traitement-donnees'],
  cookies_policy: [
    '/cookies',
    '/politique-cookies',
    '/politique-des-cookies',
    '/cookie-policy',
    '/gestion-cookies',
    '/preferences-cookies',
  ],
  contact: [
    '/contact',
    '/nous-contacter',
    '/contactez-nous',
    '/contact-us',
    '/get-in-touch',
    '/support',
    '/aide',
    '/help',
    '/fr/contact',
    '/en/contact',
  ],
  pricing: [
    '/pricing',
    '/tarifs',
    '/prix',
    '/plans',
    '/abonnement',
    '/abonnements',
    '/offres',
    '/our-pricing',
    '/fr/tarifs',
    '/en/pricing',
  ],
  about: [
    '/about',
    '/about-us',
    '/a-propos',
    '/qui-sommes-nous',
    '/notre-equipe',
    '/equipe',
    '/team',
    '/our-team',
    '/company',
    '/societe',
    '/fr/a-propos',
    '/en/about',
  ],
  blog: ['/blog', '/articles', '/actualites', '/news', '/journal', '/ressources', '/resources'],
  faq: ['/faq', '/questions', '/questions-frequentes', '/help/faq', '/aide/faq'],
  careers: ['/careers', '/jobs', '/carrieres', '/rejoindre', '/we-are-hiring', '/recrutement'],
};

const STACK_SPECIFIC: Partial<Record<PathCategory, CandidateRule[]>> = {
  sitemap: [
    {
      paths: ['/wp-sitemap.xml', '/wp-sitemap-index.xml'],
      // WP page-builder variants share the WP backend so the same sitemap
      // path applies. simplebo emits /sitemap.xml (handled by the default
      // rules), no boost needed.
      stackBoost: ['wordpress', 'wordpress_bricks', 'wordpress_elementor', 'wordpress_divi'],
    },
    {
      paths: ['/sitemap_products_1.xml', '/sitemap_pages_1.xml', '/sitemap_collections_1.xml'],
      stackBoost: ['shopify'],
    },
    {
      paths: ['/sitemap.xml', '/page-sitemap.xml'],
      stackBoost: ['webflow', 'framer', 'squarespace', 'simplebo'],
    },
    { paths: ['/sitemap-0.xml', '/sitemap.xml'], stackBoost: ['nextjs', 'nuxt'] },
  ],
};

export interface ResilientCandidatesOptions {
  /** Pages already discovered from the HTML — checked first as authoritative. */
  knownLinks?: string[];
  stack?: DetectedStack;
}

/**
 * Build an ordered list of candidate paths for a category.
 * Earlier entries are higher confidence.
 */
export function buildCandidates(
  origin: string,
  category: PathCategory,
  opts: ResilientCandidatesOptions = {},
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  // Highest priority: links the site itself exposes (parsed from the home HTML).
  // We give partial-match latitude: a footer link to "/notre-politique" wins
  // over guessing /privacy if the slug looks legal-ish for the category.
  if (opts.knownLinks) {
    const slugs = CATEGORY_SLUG_HINTS[category];
    for (const href of opts.knownLinks) {
      const normalized = normalize(href, origin);
      if (normalized && slugs.some((s) => normalized.toLowerCase().includes(s))) {
        push(out, seen, normalized);
      }
    }
  }

  // Stack-specific known paths (e.g. /wp-sitemap.xml on WP).
  if (opts.stack) {
    const stackRules = STACK_SPECIFIC[category];
    if (stackRules) {
      for (const rule of stackRules) {
        if (!rule.stackBoost || rule.stackBoost.includes(opts.stack)) {
          for (const p of rule.paths) push(out, seen, origin + p);
        }
      }
    }
  }

  // Base catalog (works for static / unknown stacks too).
  for (const p of BASE_CANDIDATES[category]) {
    push(out, seen, origin + p);
  }

  return out;
}

const CATEGORY_SLUG_HINTS: Record<PathCategory, string[]> = {
  sitemap: ['sitemap'],
  robots: ['robots.txt'],
  mentions_legales: ['mention', 'legal', 'imprint', 'impressum'],
  privacy: ['privacy', 'confidential', 'donnees', 'rgpd', 'gdpr', 'datenschutz', 'protect'],
  cgv: ['cgv', 'cgu', 'conditions', 'terms', 'tos'],
  dpa: ['dpa', 'data-processing'],
  cookies_policy: ['cookie'],
  contact: ['contact', 'aide', 'help', 'support'],
  pricing: ['pricing', 'tarif', 'prix', 'plan', 'abonnement', 'offres'],
  about: ['about', 'propos', 'equipe', 'team', 'company', 'societe'],
  blog: ['blog', 'article', 'actualit', 'news', 'ressources', 'resources'],
  faq: ['faq', 'questions'],
  careers: ['career', 'job', 'carriere', 'rejoindre', 'recrut'],
};

function normalize(href: string, origin: string): string | null {
  try {
    const u = new URL(href, origin);
    return u.origin === origin ? u.toString().replace(/\/+$/, '') || origin : null;
  } catch {
    return null;
  }
}

function push(out: string[], seen: Set<string>, url: string): void {
  const key = url.replace(/\/+$/, '').toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(url);
}

/**
 * Probe a list of candidates in order. Returns the first one that responds
 * with a 2xx. Each probe HEAD-first then falls back to a small GET (some
 * hosts respond 405 to HEAD).
 */
export async function findFirstReachable(
  candidates: string[],
  fetchImpl: typeof fetch,
  opts: { userAgent: string; timeoutMs: number },
): Promise<{ url: string; status: number; body?: string } | null> {
  for (const url of candidates) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
    }, opts.timeoutMs);
    try {
      // safeFetch validates each redirect hop against the SSRF guard so a
      // 2xx-everywhere host cannot 3xx the probe into the internal network.
      let probe = await safeFetch(
        url,
        { method: 'HEAD', signal: ctrl.signal, headers: { 'User-Agent': opts.userAgent } },
        fetchImpl,
      );
      if (probe.ok && (probe.response.status === 405 || probe.response.status === 501)) {
        probe = await safeFetch(
          url,
          {
            method: 'GET',
            signal: ctrl.signal,
            headers: { 'User-Agent': opts.userAgent, Range: 'bytes=0-2048' },
          },
          fetchImpl,
        );
      }
      if (probe.ok && probe.response.ok) {
        // Soft-404 guard: catch-all hosts answer 2xx for every path and
        // redirect unknown URLs to the home page. A real sub-page (privacy,
        // legal, contact...) never redirects to the site root, so treat a
        // root redirect as "not found" and keep probing.
        if (isSoftNotFound(url, probe.finalUrl)) continue;
        return { url: probe.finalUrl, status: probe.response.status };
      }
    } catch {
      // continue
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * True when a non-root candidate ended up redirected to the site root —
 * the signature of a catch-all / soft-404 host that serves the home page
 * for any unknown URL.
 */
function isSoftNotFound(requested: string, final: string): boolean {
  try {
    const reqPath = new URL(requested).pathname.replace(/\/+$/, '');
    const finPath = new URL(final).pathname.replace(/\/+$/, '');
    return reqPath !== '' && finPath === '';
  } catch {
    return false;
  }
}
