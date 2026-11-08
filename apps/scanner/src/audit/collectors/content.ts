import type * as cheerio from 'cheerio';

import type { ContentFacts, UiFacts, UxFacts } from '../types.js';

// Anchor text labels that strongly suggest "this link points to a blog
// or editorial section". FR + EN + common variants.
const BLOG_LINK_TEXT =
  /\b(?:blog|articles?|actualit[ée]s?|news|insights?|ressources|magazine|le[- ]journal|tribunes?)\b/i;

const SUBDOMAIN_BLOG_HOST = /^(?:blog|news|articles?|actualit[ée]s?|insights?)\./i;

/**
 * Detects an external blog linked from the site nav/header but hosted on
 * a different host than `origin`. Three signals, in order of strength :
 *  1) Subdomain explicitly named blog/news/articles/actualites/insights
 *     (e.g. blog.example.com, news.example.com).
 *  2) Same registrable suffix but different host (e.g. company.fr ->
 *     blog.company.com — partial trademark match, often owned).
 *  3) Anchor text matches BLOG_LINK_TEXT regardless of host
 *     (catches the personal-site case : company.fr -> founder-name.fr).
 * Returns the absolute URL of the first match, or null.
 */
function findExternalBlog(
  $: cheerio.CheerioAPI,
  origin: string,
  hasInternalBlog: boolean,
): string | null {
  const originHost = (() => {
    try {
      return new URL(origin).host.replace(/^www\./, '').toLowerCase();
    } catch {
      return null;
    }
  })();
  if (!originHost) return null;

  // Restrict the scan to navigation surfaces. A mention deep in the body
  // is too noisy : we want links the visitor sees in the menu / header /
  // footer, where a "Blog" entry truly redirects authority off-site.
  const subdomainHits: string[] = [];
  const anchorTextHits: string[] = [];

  $('header a[href], nav a[href], footer a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (
      href.startsWith('#') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:')
    )
      return;
    let resolved: URL;
    try {
      resolved = new URL(href, origin);
    } catch {
      return;
    }
    const host = resolved.host.replace(/^www\./, '').toLowerCase();
    if (host === originHost) return; // internal link, not an external blog

    const anchorText = $(el).text().trim();
    if (SUBDOMAIN_BLOG_HOST.test(host)) {
      subdomainHits.push(resolved.toString());
    } else if (BLOG_LINK_TEXT.test(anchorText)) {
      anchorTextHits.push(resolved.toString());
    }
  });

  // If the site has an internal blog already, anchor-text-only matches
  // (which can be noisy : "Voir nos articles" pointing to LinkedIn) are
  // ignored — only confirmed subdomain blogs count as a second source.
  const subdomain = subdomainHits[0] ?? null;
  if (hasInternalBlog) return subdomain;
  return subdomain ?? anchorTextHits[0] ?? null;
}

export function extractContent(
  $: cheerio.CheerioAPI,
  blogUrlHint: string | null,
  origin: string,
): ContentFacts {
  const clone = $.root().clone();
  clone.find('script, style, noscript, template').remove();
  const text = clone.text().replace(/\s+/g, ' ').trim();
  const wordCount = text ? text.split(/\s+/).length : 0;
  const paragraphCount = $('p').length;

  let internalLinksCount = 0;
  let externalLinksCount = 0;
  const baseHref = $('base').attr('href');
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    if (
      href.startsWith('#') ||
      href.startsWith('javascript:') ||
      href.startsWith('mailto:') ||
      href.startsWith('tel:')
    )
      return;
    try {
      const u = new URL(href, baseHref ?? 'https://placeholder.local');
      if (u.host === '' || u.host === 'placeholder.local' || u.protocol === 'data:') return;
      // Heuristic: consider relative-resolved hosts that match base as internal.
      if (baseHref) {
        const base = new URL(baseHref);
        if (u.host === base.host) internalLinksCount += 1;
        else externalLinksCount += 1;
      } else {
        // No base: treat relative paths (href starts with /) as internal.
        if (href.startsWith('/')) internalLinksCount += 1;
        else externalLinksCount += 1;
      }
    } catch {
      // ignore malformed
    }
  });

  const hasFAQSection =
    $('[id*="faq" i], [class*="faq" i], details').length > 0 ||
    /(faq|questions fr[ée]quentes|frequently asked)/i.test(text);
  const hasInternalBlog = blogUrlHint !== null || /(\/blog|\/articles|\/actualit)/i.test($.html());
  const externalBlogUrl = findExternalBlog($, origin, hasInternalBlog);
  const hasExternalBlog = externalBlogUrl !== null;

  return {
    wordCount,
    paragraphCount,
    internalLinksCount,
    externalLinksCount,
    hasFAQSection,
    // hasBlogSection now means "any blog reachable from the home" so the
    // existing BLOG_ABSENT rule keeps working : it only fires when neither
    // an internal nor an external blog is detected. The new
    // BLOG_EXTERNAL_JUS rule (rules/seo-contenu.ts) targets the
    // external-only case explicitly.
    hasBlogSection: hasInternalBlog || hasExternalBlog,
    blogUrl: blogUrlHint ?? externalBlogUrl,
    hasExternalBlog,
    externalBlogUrl,
    fleschScore: estimateFleschFr(text),
  };
}

/**
 * Rough Flesch Reading Ease adapted for French (Kandel-Moles coefficients).
 * Not a substitute for a proper tokenizer, just enough to flag walls of text.
 */
function estimateFleschFr(text: string): number | null {
  if (text.length < 400) return null;
  const sentences = Math.max(1, text.split(/[.!?]+\s/).length);
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 100) return null;
  const syllables = words.reduce((acc, w) => acc + countSyllablesFr(w), 0);
  const score = 207 - 1.015 * (words.length / sentences) - 73.6 * (syllables / words.length);
  return Math.round(score * 10) / 10;
}

function countSyllablesFr(word: string): number {
  const w = word.toLowerCase().replace(/[^a-zàâäçéèêëîïôöùûüÿœæ]+/gi, '');
  if (!w) return 0;
  const groups = w.match(/[aeiouàâäéèêëîïôöùûüœæy]+/g);
  return groups ? Math.max(1, groups.length) : 1;
}

export function extractUx($: cheerio.CheerioAPI): UxFacts {
  const viewport = $('meta[name="viewport"]').attr('content') ?? '';
  const hasMobileViewport = /width=device-width/i.test(viewport);
  const viewportBlocksZoom =
    /user-scalable\s*=\s*(no|0)/i.test(viewport) || /maximum-scale\s*=\s*1(?!\.)/i.test(viewport);

  const hasSkipLink = $('a[href^="#"]')
    .toArray()
    .some((el) => /\b(skip|aller au|aller-au|content|main)\b/i.test($(el).text()));

  const navItemsCount = $('nav a').length;
  const formsCount = $('form').length;
  const hasSearch = $('input[type="search"], [role="search"]').length > 0;

  return {
    hasMobileViewport,
    viewportBlocksZoom,
    hasSkipLink,
    navItemsCount,
    formsCount,
    hasSearch,
  };
}

export function extractUi($: cheerio.CheerioAPI): UiFacts {
  const fontFamilies = new Set<string>();
  $('[style*="font-family"]').each((_, el) => {
    const style = $(el).attr('style') ?? '';
    const m = /font-family\s*:\s*([^;]+)/i.exec(style);
    if (m?.[1]) fontFamilies.add(m[1].trim().toLowerCase());
  });
  $('link[rel="stylesheet"][href*="fonts."], link[rel="preload"][as="font"]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    const m = /family=([^&"]+)/i.exec(href);
    if (m?.[1]) fontFamilies.add(m[1].toLowerCase());
  });

  let inlineStylesBytes = 0;
  $('[style]').each((_, el) => {
    inlineStylesBytes += ($(el).attr('style') ?? '').length;
  });
  $('style').each((_, el) => {
    inlineStylesBytes += $(el).contents().text().length;
  });

  const themeColors: string[] = [];
  const themeColor = $('meta[name="theme-color"]').attr('content');
  if (themeColor) themeColors.push(themeColor);

  return {
    fontFamiliesCount: fontFamilies.size,
    inlineStylesBytes,
    themeColors,
    contrastIssuesCount: 0, // Filled later by axe-core integration.
  };
}
