import * as cheerio from 'cheerio';

import type { DetectedStack, LegalFacts } from '../types.js';

import { buildCandidates, findFirstReachable } from './resilient-paths.js';
import { readCappedText, safeFetch } from './safe-fetch.js';

const PROBE_TIMEOUT_MS = 6_000;

const COOKIE_BANNER_VENDORS: { vendor: string; patterns: RegExp[] }[] = [
  { vendor: 'tarteaucitron', patterns: [/tarteaucitron/i] },
  { vendor: 'axeptio', patterns: [/axeptio/i] },
  { vendor: 'didomi', patterns: [/didomi/i, /sdk\.privacy-center\.org/i] },
  { vendor: 'cookiebot', patterns: [/cookiebot\.com/i, /CookieConsent/i] },
  { vendor: 'onetrust', patterns: [/onetrust/i, /optanon/i] },
  { vendor: 'cookieyes', patterns: [/cookieyes/i] },
  { vendor: 'orejime', patterns: [/orejime/i] },
  { vendor: 'klaro', patterns: [/\bklaro\b/i] },
  { vendor: 'osano', patterns: [/osano\.com/i] },
  { vendor: 'iubenda', patterns: [/iubenda/i] },
  { vendor: 'cookieconsent_oss', patterns: [/cookieconsent(?!_)/i] },
];

const TRACKER_PATTERNS: { name: string; pattern: RegExp }[] = [
  {
    name: 'google_analytics',
    pattern: /google-analytics\.com|googletagmanager\.com\/gtag|gtag\(/i,
  },
  { name: 'google_tag_manager', pattern: /googletagmanager\.com\/gtm/i },
  { name: 'meta_pixel', pattern: /connect\.facebook\.net\/[^"']*\/fbevents\.js|fbq\(/i },
  { name: 'tiktok_pixel', pattern: /analytics\.tiktok\.com/i },
  { name: 'linkedin_insight', pattern: /snap\.licdn\.com\/li\.lms-analytics/i },
  { name: 'hotjar', pattern: /static\.hotjar\.com/i },
  { name: 'segment', pattern: /cdn\.segment\.com\/analytics\.js/i },
  { name: 'mixpanel', pattern: /cdn\.mxpnl\.com/i },
  { name: 'plausible', pattern: /plausible\.io\/js/i },
  { name: 'fathom', pattern: /cdn\.usefathom\.com/i },
  { name: 'matomo', pattern: /matomo\.js|piwik\.js/i },
];

export interface LegalCollectorOpts {
  userAgent: string;
  stack?: DetectedStack;
  knownLinks: string[];
}

export async function collectLegal(
  origin: string,
  html: string,
  opts: LegalCollectorOpts,
): Promise<LegalFacts> {
  const probes = await Promise.all([
    findFirstReachable(buildCandidates(origin, 'mentions_legales', opts), fetch, {
      userAgent: opts.userAgent,
      timeoutMs: PROBE_TIMEOUT_MS,
    }),
    findFirstReachable(buildCandidates(origin, 'privacy', opts), fetch, {
      userAgent: opts.userAgent,
      timeoutMs: PROBE_TIMEOUT_MS,
    }),
    findFirstReachable(buildCandidates(origin, 'cgv', opts), fetch, {
      userAgent: opts.userAgent,
      timeoutMs: PROBE_TIMEOUT_MS,
    }),
    findFirstReachable(buildCandidates(origin, 'dpa', opts), fetch, {
      userAgent: opts.userAgent,
      timeoutMs: PROBE_TIMEOUT_MS,
    }),
  ]);

  const [mentions, privacy, cgv, dpa] = probes;

  let cookiesBannerVendor: string | null = null;
  for (const { vendor, patterns } of COOKIE_BANNER_VENDORS) {
    if (patterns.some((re) => re.test(html))) {
      cookiesBannerVendor = vendor;
      break;
    }
  }
  const cookiesBannerDetected =
    cookiesBannerVendor !== null ||
    /cookie[-_ ]?(consent|banner|notice)|accepter (?:les )?cookies/i.test(html);

  const trackersDetected: string[] = [];
  for (const { name, pattern } of TRACKER_PATTERNS) {
    if (pattern.test(html)) trackersDetected.push(name);
  }

  // A DPO is declared in the privacy policy, never on the homepage. Running
  // the regex against the home text produced a near-universal false positive
  // ("DPO non mentionné" on virtually every site). Inspect the actual policy
  // page; leave `null` (unknown, not flagged) when it can't be fetched.
  const dpoMentioned = await detectDpoInPrivacyPage(privacy?.url ?? null, opts.userAgent);

  // When no same-origin legal page exists, the policy may still be reachable
  // as an off-domain link (small businesses often host legal pages on their
  // platform vendor's domain). That is not "introuvable" — it's "not hosted
  // on the site" — so we record the external URL for a reworded finding.
  const $ = cheerio.load(html);
  const privacyExternalUrl = privacy?.url
    ? null
    : findExternalLegalLink($, origin, PRIVACY_ANCHOR, ['privacy', 'confidential', 'rgpd', 'gdpr']);
  const mentionsLegalesExternalUrl = mentions?.url
    ? null
    : findExternalLegalLink($, origin, MENTIONS_ANCHOR, ['mention', 'legal', 'imprint']);

  return {
    mentionsLegalesUrl: mentions?.url ?? null,
    mentionsLegalesStatus: mentions?.status ?? null,
    mentionsLegalesExternalUrl,
    privacyUrl: privacy?.url ?? null,
    privacyStatus: privacy?.status ?? null,
    privacyExternalUrl,
    cgvUrl: cgv?.url ?? null,
    cgvStatus: cgv?.status ?? null,
    dpaUrl: dpa?.url ?? null,
    cookiesBannerDetected,
    cookiesBannerVendor,
    dpoMentioned,
    trackersDetected,
  };
}

const PRIVACY_ANCHOR =
  /confidentialit|\brgpd\b|\bgdpr\b|donn[ée]es personnelles|privacy|protection des donn[ée]es/i;
const MENTIONS_ANCHOR = /mentions l[ée]gales|legal notice|imprint|impressum/i;

/**
 * Look for a header/nav/footer link pointing to a legal page hosted on a
 * different host than the audited site. Matches on anchor text or on the
 * href slug. Returns the first external match, or null.
 */
function findExternalLegalLink(
  $: cheerio.CheerioAPI,
  origin: string,
  anchorPattern: RegExp,
  hrefSlugs: string[],
): string | null {
  let originHost: string;
  try {
    originHost = new URL(origin).host.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }

  let found: string | null = null;
  $('header a[href], nav a[href], footer a[href]').each((_, el) => {
    if (found) return;
    const href = $(el).attr('href');
    if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return;
    }
    let resolved: URL;
    try {
      resolved = new URL(href, origin);
    } catch {
      return;
    }
    if (resolved.host.replace(/^www\./, '').toLowerCase() === originHost) return; // same-origin
    const anchorText = $(el).text().trim();
    const slug = resolved.pathname.toLowerCase();
    if (anchorPattern.test(anchorText) || hrefSlugs.some((s) => slug.includes(s))) {
      found = resolved.toString();
    }
  });
  return found;
}

const DPO_PATTERN =
  /\b(d\.?p\.?o\.?|d[ée]l[ée]gu[ée] [aà] la protection des donn[ée]es|data protection officer)\b/i;

/**
 * Fetch the privacy-policy page and look for a DPO mention in its text.
 * Returns `null` when the page cannot be retrieved — the caller must treat
 * `null` as "unknown" and not assert a missing-DPO finding.
 */
async function detectDpoInPrivacyPage(
  privacyUrl: string | null,
  userAgent: string,
): Promise<boolean | null> {
  if (!privacyUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, PROBE_TIMEOUT_MS);
  try {
    // safeFetch validates every redirect hop against the SSRF guard: the
    // audited site controls this page and could 3xx us into the internal
    // network. Body is capped to avoid an unbounded download.
    const result = await safeFetch(privacyUrl, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { 'User-Agent': userAgent, Accept: 'text/html,*/*;q=0.8' },
    });
    if (!result.ok || !result.response.ok) return null;
    const body = await readCappedText(result.response);
    // Strip tags so attribute values / script content can't trip the regex.
    const text = body
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
    return DPO_PATTERN.test(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
