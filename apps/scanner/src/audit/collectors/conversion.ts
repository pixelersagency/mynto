import type * as cheerio from 'cheerio';

import type { ConversionFacts, DetectedStack } from '../types.js';

import { buildCandidates, findFirstReachable } from './resilient-paths.js';

const PROBE_TIMEOUT_MS = 6_000;

// Trust logo bar : section that lists customer/partner logos as social
// proof. Vocabulary covers FR + EN patterns observed across PME / SaaS /
// agencies / consulting.
export const TRUST_LOGO_HINTS =
  /trust|client|partenaire|comme[ -]vu|featured-in|logos?-clients?|brands?[-_ ]bar|confiance|trusted[-_ ]?by|references?[-_ ]bar|as[-_ ]seen[-_ ]in|ils[-_ ]nous/i;

// Testimonial / case-study container vocabulary. The previous list
// (testimoni|temoignage|avis-client|review|verbat) missed the FR
// vocabulary used by SaaS / consulting sites that publish video case
// studies (Klanik, Octo, etc.) or named cards, so the rule kept firing
// "Aucun témoignage client visible" on sites that obviously had them.
export const TESTIMONIAL_HINTS =
  /testimoni|temoignage|avis[-_ ]?client|review|verbat|case[-_ ]?stud(?:y|ies)|cas[-_ ]?client|success[-_ ]?stor(?:y|ies)|client[-_ ]?stor(?:y|ies)|customer[-_ ]?stor(?:y|ies)|histoires?[-_ ]?client|references?|preuves?[-_ ]?social/i;

// Embedded video providers used to host customer case studies. A YouTube
// or Vimeo iframe inside a testimonial section is treated as equivalent
// to a customer photo (a video is stronger social proof than a still).
const VIDEO_EMBED_REGEX = /youtube\.com|youtu\.be|vimeo\.com|wistia\.com|loom\.com/i;

// Job-title vocabulary used to spot "Photo + Nom + Fonction" testimonial
// cards (a common pattern: three plain divs with photo, name and role,
// no semantic class). Keep the
// list short to avoid matching nav items like "Founder Story".
const ROLE_HINTS =
  /\b(?:CEO|CTO|CFO|COO|CMO|VP|Founder|Co[- ]?founder|Directeur|Directrice|Responsable|Manager|Head\s+of|Chef\s+de|Pr[ée]sident(?:e)?|Fondat(?:eur|rice)|Gerant(?:e)?|Consultant(?:e)?)\b/i;

// "Prénom Nom" shape used in testimonial author lines. Matches two
// capitalised tokens of 2+ chars each. Anchored with whitespace so it
// does not catch random PascalCase identifiers in scripts.
const PERSON_NAME_REGEX =
  /(?:^|\s)([A-ZÉÈÀÂÎÔÛÇ][a-zéèêàâîïôûüç]{1,})\s+([A-ZÉÈÀÂÎÔÛÇ][a-zéèêàâîïôûüç]{2,})/;
// Broad CTA vocabulary covering FR + EN action verbs commonly used on
// PME/SaaS sites. The previous list was tuned for SaaS sign-up flows and
// missed the bulk of small-business CTAs (contact, devis, RDV, shop,
// download, etc.), producing systematic false positives on the
// "no CTA above the fold" rule.
export const CTA_HINTS = new RegExp(
  [
    // start / try / sign up
    'commencer',
    'd[ée]marrer',
    'lancer',
    'essayer',
    'essai(?:\\s+gratuit)?',
    'try(?:\\s+(?:now|it|free))?',
    'get\\s+started',
    'start(?:\\s+(?:free|now))?',
    "s['’]inscrire",
    'inscription',
    'sign[\\s-]?up',
    'signup',
    'cr[ée]er\\s+(?:un|mon)\\s+compte',
    "s['’]abonner",
    'subscribe',
    'abonnez[-\\s]vous',
    // contact / book / quote / appointment
    'contact(?:ez|er|[-\\s]nous)?',
    'contact\\s+us',
    'nous\\s+contacter',
    'demander\\s+(?:un\\s+)?(?:devis|rendez[-\\s]vous|rdv|d[ée]mo)',
    'devis(?:\\s+gratuit)?',
    'request(?:\\s+(?:a\\s+)?(?:quote|demo|access))?',
    'get\\s+(?:a\\s+)?quote',
    'r[ée]serv(?:e[rz]?|[ée]e?|ation)?', // réserver, réserve, réservez, réservé(e), réservation
    'book(?:\\s+(?:now|a\\s+demo|a\\s+call))?',
    'prendre\\s+(?:un\\s+)?(?:rdv|rendez[-\\s]vous)',
    'rendez[-\\s]vous', // standalone "Mon rendez-vous", "Prendre rendez-vous", "Je réserve mon rendez-vous"
    'appointment',
    'schedule(?:\\s+a\\s+(?:call|demo))?',
    'demo',
    // commerce
    'acheter',
    'commander',
    'order(?:\\s+now)?',
    'buy(?:\\s+now)?',
    'shop(?:\\s+now)?',
    'ajouter\\s+au\\s+panier',
    'add\\s+to\\s+(?:cart|basket)',
    // learn / discover / download
    'en\\s+savoir\\s+plus',
    'learn\\s+more',
    'd[ée]couvrir',
    'discover',
    'voir\\s+(?:nos|plus)',
    't[ée]l[ée]charger',
    'download',
    // call
    'appeler',
    'call\\s+us',
    'nous\\s+appeler',
  ].join('|'),
  'i',
);

export interface ConversionCollectorOpts {
  userAgent: string;
  stack?: DetectedStack;
  knownLinks: string[];
}

export async function collectConversion(
  origin: string,
  $: cheerio.CheerioAPI,
  opts: ConversionCollectorOpts,
): Promise<ConversionFacts> {
  const pricingProbe = await findFirstReachable(buildCandidates(origin, 'pricing', opts), fetch, {
    userAgent: opts.userAgent,
    timeoutMs: PROBE_TIMEOUT_MS,
  });
  const contactProbe = await findFirstReachable(buildCandidates(origin, 'contact', opts), fetch, {
    userAgent: opts.userAgent,
    timeoutMs: PROBE_TIMEOUT_MS,
  });

  const pricingAnchor = $('a[href*="#pricing"], a[href*="#tarif"], a[href*="#prix"]').length > 0;
  const pricingIsAnchorOnly = !pricingProbe && pricingAnchor;

  const phoneRegex = /(?:\+33|0033|0)\s?[1-9](?:[\s.-]?\d{2}){4}|tel:[+\d]/gi;
  const homeText = $.root().text();
  const contactHasPhone = phoneRegex.test(homeText) || $('a[href^="tel:"]').length > 0;
  const contactHasEmail =
    $('a[href^="mailto:"]').length > 0 || /[\w.+-]+@[\w-]+\.[\w.-]+/.test(homeText);
  const contactHasForm = $('form').length > 0;
  const contactHasWhatsApp = /wa\.me\/|api\.whatsapp\.com\/send|chat\.whatsapp\.com/i.test(
    $.html(),
  );

  // Testimonials v2 — combine four orthogonal signals so we capture the
  // common cases the previous regex-only detection missed:
  //   1) Class/id hint (case-studies, cas-clients, references, ...)
  //   2) Native <blockquote> elements with non-trivial text
  //   3) JSON-LD schema.org/Review (or AggregateRating) entries
  //   4) "Photo + Nom + Fonction" card pattern (img + person name + role
  //      in the same compact container) — the consulting-site case
  //      that has no semantic hint at all.
  // Each signal contributes to a Set of unique elements (or to dedicated
  // counters for the JSON-LD path) so the same testimonial cannot be
  // counted twice. testimonialsHavePhoto / Name flip true on the first
  // occurrence in any signal.
  const TESTIMONIAL_MIN_TEXT = 80;
  const NAME_CARD_MAX_TEXT = 600;
  const countedNodes = new Set<unknown>();
  let testimonialsCount = 0;
  let testimonialsHaveName = false;
  let testimonialsHavePhoto = false;

  function recordTestimonial(node: unknown, hasName: boolean, hasPhoto: boolean): void {
    if (countedNodes.has(node)) return;
    countedNodes.add(node);
    testimonialsCount += 1;
    if (hasName) testimonialsHaveName = true;
    if (hasPhoto) testimonialsHavePhoto = true;
  }

  // Signal 1 + 2 fused: scan class/id hint sections and standalone
  // blockquotes in the same pass to dedupe by element identity.
  $('*[class], *[id], section, article, aside, blockquote').each((_, el) => {
    const $el = $(el);
    const tag = 'tagName' in el ? el.tagName.toLowerCase() : '';
    const classId = ($el.attr('class') ?? '') + ' ' + ($el.attr('id') ?? '');
    const matchesHint = TESTIMONIAL_HINTS.test(classId);
    const isBlockquote = tag === 'blockquote';
    if (!matchesHint && !isBlockquote) return;

    const hasImg = $el.find('img').length > 0;
    const hasVideo = $el
      .find('iframe[src]')
      .toArray()
      .some((iframe) => VIDEO_EMBED_REGEX.test($(iframe).attr('src') ?? ''));
    const text = $el.text();
    const trimmedLen = text.replace(/\s+/g, ' ').trim().length;
    // Substance gate : skip empty nav links labeled "Références" /
    // "Témoignages" or empty <blockquote/>. A real testimonial has either
    // an image, a video embed, or carries a quote (>= 80 chars).
    const hasSubstance = hasImg || hasVideo || trimmedLen >= TESTIMONIAL_MIN_TEXT;
    if (!hasSubstance) return;

    const hasName = PERSON_NAME_REGEX.test(text);
    recordTestimonial(el, hasName, hasImg || hasVideo);
  });

  // Signal 3 — JSON-LD schema.org Review / AggregateRating. Many themes
  // emit a structured Review block without any matching CSS selector.
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (raw.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const items = Array.isArray(parsed) ? parsed : [parsed];
    for (const item of items) {
      countSchemaReview(item, recordTestimonial);
    }
  });

  // Signal 4 — "Photo + Nom + Fonction" card pattern. We look for
  // containers that hold exactly one <img>, a person name, and a role
  // keyword in a short text block. This catches the grid of three
  // testimonial cards on a typical consulting / agency home where no
  // semantic class is used (the plain-div case).
  $('div, article, li, figure').each((_, el) => {
    const $el = $(el);
    if (countedNodes.has(el)) return;
    const imgs = $el.find('img');
    if (imgs.length === 0 || imgs.length > 4) return; // 1 portrait, sometimes a logo too
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (text.length === 0 || text.length > NAME_CARD_MAX_TEXT) return;
    const nameMatch = PERSON_NAME_REGEX.test(text);
    const roleMatch = ROLE_HINTS.test(text);
    if (nameMatch && roleMatch) {
      recordTestimonial(el, true, true);
    }
  });

  let trustLogosCount = 0;
  $('*[class], *[id], section').each((_, el) => {
    const $el = $(el);
    const classId = ($el.attr('class') ?? '') + ' ' + ($el.attr('id') ?? '');
    if (TRUST_LOGO_HINTS.test(classId)) {
      trustLogosCount += $el.find('img').length;
    }
  });

  let ctaCount = 0;
  $('a, button').each((_, el) => {
    const $el = $(el);
    const text = $el.text().trim();
    if (text.length > 0 && CTA_HINTS.test(text)) ctaCount += 1;
  });

  // Above-the-fold = any CTA-matching link/button found in the first N
  // descendants of <body> in DOM order. The previous selector relied on
  // `header, [class*="hero"], [class*="banner"]` which missed Bricks,
  // Elementor, Oxygen and FSE blocks (no hero/banner hint) as well as
  // pages whose first interactive section is just `<section>` or
  // `<div class="container">`. Counting elements approximates "early in
  // the page" without needing a real layout pass.
  const ABOVE_FOLD_ELEMENT_BUDGET = 200;
  let ctaAboveFold = false;
  let elementsSeen = 0;
  $('body *').each((_, el) => {
    if (ctaAboveFold) return false;
    elementsSeen += 1;
    if (elementsSeen > ABOVE_FOLD_ELEMENT_BUDGET) return false;
    const tag = 'tagName' in el ? el.tagName.toLowerCase() : '';
    if (tag !== 'a' && tag !== 'button') return;
    const text = $(el).text().trim();
    if (text.length > 0 && CTA_HINTS.test(text)) {
      ctaAboveFold = true;
    }
  });

  return {
    pricingUrl: pricingProbe?.url ?? null,
    pricingIsAnchorOnly,
    contactUrl: contactProbe?.url ?? null,
    contactHasPhone,
    contactHasEmail,
    contactHasForm,
    contactHasWhatsApp,
    testimonialsCount,
    testimonialsHaveName,
    testimonialsHavePhoto,
    trustLogosCount,
    ctaCount,
    ctaAboveFold,
  };
}

/**
 * Walks a JSON-LD object (and any embedded @graph) looking for
 * `Review` / `AggregateRating` entries and records each as a
 * testimonial. We use a synthetic node key so dedup against the DOM scan
 * still works (the DOM scan uses element identity; here we use a unique
 * symbol per entry).
 */
function countSchemaReview(
  node: unknown,
  record: (key: unknown, hasName: boolean, hasPhoto: boolean) => void,
): void {
  if (node === null || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;

  if (Array.isArray(obj['@graph'])) {
    for (const entry of obj['@graph']) countSchemaReview(entry, record);
  }

  const type = obj['@type'];
  const types = Array.isArray(type) ? type.map(String) : typeof type === 'string' ? [type] : [];
  if (types.some((t) => /^Review$/i.test(t))) {
    const author = obj.author;
    let hasName = false;
    if (typeof author === 'string') hasName = author.trim().length > 1;
    else if (author && typeof author === 'object') {
      const name = (author as Record<string, unknown>).name;
      if (typeof name === 'string') hasName = name.trim().length > 1;
    }
    record(Symbol('jsonld-review'), hasName, /* hasPhoto */ false);
  }

  if (types.some((t) => /^AggregateRating$/i.test(t))) {
    const count = obj.reviewCount ?? obj.ratingCount;
    const n = typeof count === 'number' ? count : Number(count);
    if (Number.isFinite(n) && n > 0) {
      // AggregateRating tells us "we have N reviews" without enumerating
      // each one. Add a single synthetic testimonial so the count is at
      // least non-zero ; we can't know name/photo without per-Review
      // entries, so treat as anonymous.
      record(Symbol('jsonld-aggregate'), false, false);
    }
  }
}
