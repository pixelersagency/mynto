/* eslint-disable @typescript-eslint/no-unnecessary-condition --
 * Defensive DOM access. The DOM lib types overstate non-nullability
 * (doc.location, documentElement, body, naturalWidth…) but this code runs
 * in a content script against arbitrary, sometimes hostile or partially
 * built pages — every guard is intentional and load-bearing at runtime. */
import type { DomFacts } from './types.js';

/**
 * Reads everything the local checks need from a rendered Document. The ONLY
 * browser-coupled function in the package. Never throws : every field has a
 * safe default so a hostile or weird page still yields a usable snapshot.
 */
export function extractDomFacts(doc: Document, win?: Window): DomFacts {
  const url = doc.location?.href ?? '';
  const origin = safeOrigin(url);
  const html = doc.documentElement?.outerHTML ?? '';

  const lang = attr(doc.documentElement, 'lang');
  const title = doc.querySelector('title')?.textContent?.trim() ?? null;

  const metaDescription = metaContent(doc, 'meta[name="description" i]');
  const canonical = doc.querySelector('link[rel="canonical" i]')?.getAttribute('href') ?? null;
  const robotsMeta = metaContent(doc, 'meta[name="robots" i]');
  const viewport = metaContent(doc, 'meta[name="viewport" i]');
  const charset =
    doc.querySelector('meta[charset]')?.getAttribute('charset') ??
    metaContent(doc, 'meta[http-equiv="Content-Type" i]');
  const themeColor = metaContent(doc, 'meta[name="theme-color" i]');
  const generatorMeta = metaContent(doc, 'meta[name="generator" i]');

  const ogTags: Record<string, string> = {};
  doc.querySelectorAll('meta[property^="og:" i]').forEach((el) => {
    const p = el.getAttribute('property');
    const c = el.getAttribute('content');
    if (p && c) ogTags[p.toLowerCase()] = c;
  });
  const twitterTags: Record<string, string> = {};
  doc.querySelectorAll('meta[name^="twitter:" i]').forEach((el) => {
    const n = el.getAttribute('name');
    const c = el.getAttribute('content');
    if (n && c) twitterTags[n.toLowerCase()] = c;
  });

  const hreflangs: { lang: string; href: string }[] = [];
  doc.querySelectorAll('link[rel="alternate" i][hreflang]').forEach((el) => {
    const l = el.getAttribute('hreflang');
    const h = el.getAttribute('href');
    if (l && h) hreflangs.push({ lang: l, href: h });
  });

  const jsonLdNodes = Array.from(doc.querySelectorAll('script[type="application/ld+json" i]'));
  const jsonLdTypes: string[] = [];
  for (const node of jsonLdNodes) {
    try {
      const parsed: unknown = JSON.parse(node.textContent ?? '');
      collectJsonLdTypes(parsed, jsonLdTypes);
    } catch {
      // ignore malformed JSON-LD
    }
  }

  const faviconHref =
    doc.querySelector('link[rel~="icon" i]')?.getAttribute('href') ??
    doc.querySelector('link[rel="shortcut icon" i]')?.getAttribute('href') ??
    null;

  // --- headings ---
  const headingNodes = Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6'));
  const headingOutline = headingNodes.map((h) => ({
    level: Number(h.tagName.charAt(1)),
    text: (h.textContent ?? '').trim().slice(0, 120),
  }));
  const h1Texts = headingOutline.filter((h) => h.level === 1).map((h) => h.text);
  const headingHierarchyBroken = detectHierarchyBreak(headingOutline.map((h) => h.level));

  // --- images ---
  const imgs = Array.from(doc.querySelectorAll('img'));
  let imagesWithAlt = 0;
  let imagesEmptyAlt = 0;
  let imagesLazy = 0;
  let imagesWithDimensions = 0;
  let imagesOversized = 0;
  for (const img of imgs) {
    const alt = img.getAttribute('alt');
    if (alt !== null && alt.trim().length > 0) imagesWithAlt += 1;
    if (alt !== null && alt.trim().length === 0) imagesEmptyAlt += 1;
    if ((img.getAttribute('loading') ?? '').toLowerCase() === 'lazy') imagesLazy += 1;
    if (img.getAttribute('width') && img.getAttribute('height')) imagesWithDimensions += 1;
    const nw = img.naturalWidth || 0;
    const cw = img.clientWidth || 0;
    if (nw > 0 && cw > 0 && nw > cw * 2) imagesOversized += 1;
  }

  // --- links ---
  const anchors = Array.from(doc.querySelectorAll('a[href]'));
  let linksInternal = 0;
  let linksExternal = 0;
  let linksNoText = 0;
  let linksNewTabNoRel = 0;
  let hasPhoneLink = false;
  let hasMailtoLink = false;
  let hasContactLink = false;
  let hasBlogLink = false;
  let legalMentions = false;
  let legalPrivacy = false;
  let legalCgv = false;
  for (const a of anchors) {
    const href = a.getAttribute('href') ?? '';
    const text = accessibleText(a);
    if (href.startsWith('tel:')) hasPhoneLink = true;
    if (href.startsWith('mailto:')) hasMailtoLink = true;
    if (/contact/i.test(href) || /contact/i.test(text)) hasContactLink = true;
    if (/\b(blog|articles?|actualit|news|magazine)\b/i.test(href + ' ' + text)) hasBlogLink = true;
    if (/mentions?[-_ ]?l[eé]gales?/i.test(href + ' ' + text)) legalMentions = true;
    if (/(privacy|confidentialit|donn[eé]es?[-_ ]?personnelles)/i.test(href + ' ' + text))
      legalPrivacy = true;
    if (/\b(cgv|cgu|conditions[-_ ]?g[eé]n[eé]rales|terms)\b/i.test(href + ' ' + text))
      legalCgv = true;
    if (text.length === 0 && !a.querySelector('img[alt]:not([alt=""])')) linksNoText += 1;
    if ((a.getAttribute('target') ?? '') === '_blank') {
      const rel = (a.getAttribute('rel') ?? '').toLowerCase();
      if (!rel.includes('noopener') && !rel.includes('noreferrer')) linksNewTabNoRel += 1;
    }
    if (href.startsWith('#') || href.startsWith('javascript:')) continue;
    const abs = safeUrl(href, origin);
    if (!abs) continue;
    if (abs.origin === origin) linksInternal += 1;
    else linksExternal += 1;
  }

  // --- content ---
  const bodyText = (doc.body?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0;
  const paragraphCount = doc.querySelectorAll('p').length;
  const textLangSampleFrench = /\b(le|la|les|des|une?|et|vous|nous|pour|avec)\b/i.test(bodyText);

  // --- forms / nav / structure ---
  const navItems = doc.querySelectorAll('nav a').length;
  const forms = Array.from(doc.querySelectorAll('form'));
  const formsCount = forms.length;
  let inputsWithoutLabel = 0;
  doc.querySelectorAll('input, select, textarea').forEach((el) => {
    const type = (el.getAttribute('type') ?? '').toLowerCase();
    if (type === 'hidden' || type === 'submit' || type === 'button') return;
    const id = el.getAttribute('id');
    const labelByFor = id !== null && doc.querySelector(`label[for="${cssEscape(id)}"]`) !== null;
    const hasAria =
      (el.getAttribute('aria-label') ?? '').trim().length > 0 ||
      (el.getAttribute('aria-labelledby') ?? '').trim().length > 0;
    const insideLabel = el.closest('label') !== null;
    if (!labelByFor && !hasAria && !insideLabel) inputsWithoutLabel += 1;
  });
  const hasSearch = doc.querySelector('input[type="search"], [role="search" i]') !== null;
  const hasSkipLink = Array.from(doc.querySelectorAll('a[href^="#"]')).some((a) =>
    /\b(skip|aller au|aller-au|contenu|content|main)\b/i.test(a.textContent ?? ''),
  );
  const landmarks = {
    header: doc.querySelector('header, [role="banner" i]') !== null,
    nav: doc.querySelector('nav, [role="navigation" i]') !== null,
    main: doc.querySelector('main, [role="main" i]') !== null,
    footer: doc.querySelector('footer, [role="contentinfo" i]') !== null,
  };

  // --- conversion ---
  const ctaButtons = doc.querySelectorAll(
    'a.btn, a.button, button, [class*="cta" i], [class*="btn" i]',
  ).length;
  const testimonialHints = doc.querySelectorAll(
    '[class*="testimonial" i], [class*="temoignage" i], [class*="avis" i], blockquote, cite',
  ).length;
  const trustLogoHints = doc.querySelectorAll(
    '[class*="logo" i] img, [class*="partner" i] img, [class*="client" i] img, [class*="trust" i] img',
  ).length;

  // --- conformité ---
  const trackers = detectTrackers(html);
  const cookieBannerVendor = detectCookieVendor(html);
  const legalCookies = cookieBannerVendor !== null || /cookie/i.test(html);

  // --- performance heuristics ---
  const domNodeCount = doc.querySelectorAll('*').length;
  const scripts = Array.from(doc.querySelectorAll('script'));
  const scriptCount = scripts.filter((s) => s.getAttribute('src')).length;
  const inlineScriptCount = scripts.filter(
    (s) => !s.getAttribute('src') && (s.textContent ?? '').trim().length > 0,
  ).length;
  const stylesheetCount = doc.querySelectorAll('link[rel="stylesheet" i]').length;
  const renderBlockingStyles = Array.from(
    doc.querySelectorAll('head link[rel="stylesheet" i]'),
  ).filter((l) => {
    const media = (l.getAttribute('media') ?? '').toLowerCase();
    return media === '' || media === 'all' || media === 'screen';
  }).length;
  let inlineStyleBytes = 0;
  doc.querySelectorAll('[style]').forEach((el) => {
    inlineStyleBytes += (el.getAttribute('style') ?? '').length;
  });
  doc.querySelectorAll('style').forEach((el) => {
    inlineStyleBytes += (el.textContent ?? '').length;
  });
  let totalImageBytesEstimate = 0;
  for (const img of imgs) {
    const nw = img.naturalWidth || 0;
    const nh = img.naturalHeight || 0;
    if (nw > 0 && nh > 0) totalImageBytesEstimate += Math.round((nw * nh * 0.25) / 1000); // ~KB rough
  }
  const isHttps = origin.startsWith('https://');

  // --- UI ---
  const fontFamilies = sampleFontFamilies(doc, win);
  const colorCount = sampleColors(doc, win);
  const usesViewportMeta = viewport !== null && /width=device-width/i.test(viewport);
  const viewportBlocksZoom =
    viewport !== null &&
    (/user-scalable\s*=\s*(no|0)/i.test(viewport) || /maximum-scale\s*=\s*1(?!\.)/i.test(viewport));

  // --- dated-tech (regex on rendered HTML, mirrors scanner tech-age) ---
  const jqm = /jquery[/-](\d+)\.(\d+)/i.exec(html);
  const jqueryMajor = jqm ? Number(jqm[1]) : null;
  const bsm = /(?<![a-z0-9-])bootstrap[@/._-]?(\d+)\.(\d+)/i.exec(html);
  const bootstrapMajor = bsm ? Number(bsm[1]) : null;
  const deprecatedTags = ['font', 'center', 'marquee', 'frameset', 'blink', 'tt'].filter((t) =>
    new RegExp(`<${t}[\\s>/]`, 'i').test(html),
  );
  const flashDetected = /\.swf\b/i.test(html) || /application\/x-shockwave-flash/i.test(html);
  const doctype = doc.doctype;
  const legacyDoctype = doctype
    ? doctype.publicId.length > 0 || /xhtml|html 4/i.test(doctype.publicId || '')
    : false;
  const layoutTables = countLayoutTables(doc);

  return {
    url,
    origin,
    lang,
    title,
    metaDescription,
    canonical,
    robotsMeta,
    viewport,
    charset,
    themeColor,
    ogTags,
    twitterTags,
    hreflangs,
    jsonLdCount: jsonLdNodes.length,
    jsonLdTypes,
    faviconHref,
    h1Count: h1Texts.length,
    h1Texts,
    headingOutline,
    headingHierarchyBroken,
    imagesTotal: imgs.length,
    imagesWithAlt,
    imagesEmptyAlt,
    imagesLazy,
    imagesWithDimensions,
    imagesOversized,
    linksInternal,
    linksExternal,
    linksNoText,
    linksNewTabNoRel,
    wordCount,
    paragraphCount,
    hasBlogLink,
    textLangSampleFrench,
    navItems,
    formsCount,
    inputsWithoutLabel,
    hasSearch,
    hasSkipLink,
    landmarks,
    ctaButtons,
    hasPhoneLink,
    hasMailtoLink,
    hasContactLink,
    testimonialHints,
    trustLogoHints,
    legalLinks: {
      mentions: legalMentions,
      privacy: legalPrivacy,
      cgv: legalCgv,
      cookies: legalCookies,
    },
    trackers,
    cookieBannerVendor,
    domNodeCount,
    scriptCount,
    inlineScriptCount,
    stylesheetCount,
    renderBlockingStyles,
    inlineStyleBytes,
    totalImageBytesEstimate,
    isHttps,
    fontFamilies,
    colorCount,
    usesViewportMeta,
    viewportBlocksZoom,
    jqueryMajor,
    bootstrapMajor,
    deprecatedTags,
    flashDetected,
    legacyDoctype,
    layoutTables,
    generatorMeta,
    detectedCms: detectCms(html, generatorMeta),
  };
}

// --- helpers -------------------------------------------------------------

function attr(el: Element | null, name: string): string | null {
  const v = el?.getAttribute(name);
  return v && v.trim().length > 0 ? v.trim() : null;
}

function metaContent(doc: Document, selector: string): string | null {
  const c = doc.querySelector(selector)?.getAttribute('content');
  return c && c.trim().length > 0 ? c.trim() : null;
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

function safeUrl(href: string, base: string): URL | null {
  try {
    return new URL(href, base || undefined);
  } catch {
    return null;
  }
}

function accessibleText(el: Element): string {
  const aria = (el.getAttribute('aria-label') ?? '').trim();
  if (aria.length > 0) return aria;
  const text = (el.textContent ?? '').trim();
  if (text.length > 0) return text;
  return (el.getAttribute('title') ?? '').trim();
}

function cssEscape(id: string): string {
  return id.replace(/["\\]/g, '\\$&');
}

function collectJsonLdTypes(node: unknown, out: string[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collectJsonLdTypes(n, out);
    return;
  }
  if (node && typeof node === 'object') {
    const t = (node as Record<string, unknown>)['@type'];
    if (typeof t === 'string') out.push(t);
    else if (Array.isArray(t)) for (const x of t) if (typeof x === 'string') out.push(x);
    const graph = (node as Record<string, unknown>)['@graph'];
    if (graph) collectJsonLdTypes(graph, out);
  }
}

function detectHierarchyBreak(levels: number[]): boolean {
  let prev = 0;
  for (const lvl of levels) {
    if (prev > 0 && lvl > prev + 1) return true;
    prev = lvl;
  }
  return false;
}

function detectTrackers(html: string): string[] {
  const out: string[] = [];
  const sigs: [string, RegExp][] = [
    ['Google Analytics', /google-analytics\.com|gtag\(|googletagmanager\.com|G-[A-Z0-9]{8,}/i],
    ['Meta Pixel', /connect\.facebook\.net|fbq\(/i],
    ['Hotjar', /static\.hotjar\.com|hjsv/i],
    ['LinkedIn', /snap\.licdn\.com/i],
    ['TikTok', /analytics\.tiktok\.com/i],
    ['Matomo', /matomo\.js|piwik\.js/i],
    ['HubSpot', /js\.hs-scripts\.com/i],
  ];
  for (const [name, re] of sigs) if (re.test(html)) out.push(name);
  return out;
}

function detectCookieVendor(html: string): string | null {
  const sigs: [string, RegExp][] = [
    ['Axeptio', /axeptio/i],
    ['OneTrust', /onetrust|optanon/i],
    ['Didomi', /didomi/i],
    ['Cookiebot', /cookiebot/i],
    ['Tarteaucitron', /tarteaucitron/i],
    ['CookieYes', /cookieyes/i],
  ];
  for (const [name, re] of sigs) if (re.test(html)) return name;
  return null;
}

function detectCms(html: string, generator: string | null): string | null {
  const g = (generator ?? '').toLowerCase();
  if (/wordpress/i.test(html) || g.includes('wordpress')) return 'WordPress';
  if (/cdn\.shopify\.com|myshopify/i.test(html) || g.includes('shopify')) return 'Shopify';
  if (/wixstatic\.com|parastorage/i.test(html)) return 'Wix';
  if (/webflow/i.test(html) || g.includes('webflow')) return 'Webflow';
  if (/squarespace/i.test(html) || g.includes('squarespace')) return 'Squarespace';
  if (/framerusercontent|data-framer-/i.test(html) || g.includes('framer')) return 'Framer';
  if (/__NEXT_DATA__|\/_next\//.test(html)) return 'Next.js';
  if (/simplebo\.net|sbcdnsb/i.test(html)) return 'SimpleBO';
  return null;
}

function countLayoutTables(doc: Document): number {
  let count = 0;
  doc.querySelectorAll('table').forEach((t) => {
    const hasTh = t.querySelector('th') !== null;
    const role = (t.getAttribute('role') ?? '').toLowerCase();
    const isGrid = role === 'grid' || role === 'table';
    const hasPresAttrs =
      t.hasAttribute('cellpadding') ||
      t.hasAttribute('cellspacing') ||
      t.hasAttribute('border') ||
      t.hasAttribute('bgcolor') ||
      t.hasAttribute('background');
    const nested = t.querySelector('table') !== null;
    if (!hasTh && !isGrid && (hasPresAttrs || nested)) count += 1;
  });
  return count;
}

function sampleFontFamilies(doc: Document, win?: Window): string[] {
  const w = win ?? (typeof window !== 'undefined' ? window : undefined);
  if (!w?.getComputedStyle) return [];
  const fams = new Set<string>();
  const sample = ['body', 'h1', 'h2', 'p', 'a', 'button'];
  for (const sel of sample) {
    const el = doc.querySelector(sel);
    if (!el) continue;
    const ff = w.getComputedStyle(el).fontFamily;
    if (ff) fams.add(ff.split(',')[0]?.replace(/["']/g, '').trim().toLowerCase() ?? '');
  }
  fams.delete('');
  return [...fams];
}

function sampleColors(doc: Document, win?: Window): number {
  const w = win ?? (typeof window !== 'undefined' ? window : undefined);
  if (!w?.getComputedStyle) return 0;
  const colors = new Set<string>();
  const els = Array.from(
    doc.querySelectorAll('body, h1, h2, h3, p, a, button, header, footer'),
  ).slice(0, 40);
  for (const el of els) {
    const cs = w.getComputedStyle(el);
    if (cs.color) colors.add(cs.color);
    if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)')
      colors.add(cs.backgroundColor);
  }
  return colors.size;
}
