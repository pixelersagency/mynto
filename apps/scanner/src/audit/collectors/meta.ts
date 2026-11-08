import type * as cheerio from 'cheerio';

import type { HeadingFacts, ImageFacts, MetaFacts } from '../types.js';

export function extractMeta($: cheerio.CheerioAPI): MetaFacts {
  const og: Record<string, string> = {};
  const twitter: Record<string, string> = {};
  const hreflangs: { lang: string; href: string }[] = [];
  const jsonLd: unknown[] = [];

  $('meta').each((_, el) => {
    const $el = $(el);
    const property = $el.attr('property')?.toLowerCase();
    const name = $el.attr('name')?.toLowerCase();
    const content = $el.attr('content') ?? '';
    if (!content) return;
    if (property?.startsWith('og:')) og[property] = content;
    if (name?.startsWith('twitter:')) twitter[name] = content;
  });

  $('link[rel="alternate"][hreflang]').each((_, el) => {
    const $el = $(el);
    const lang = $el.attr('hreflang');
    const href = $el.attr('href');
    if (lang && href) hreflangs.push({ lang, href });
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    try {
      jsonLd.push(JSON.parse(raw));
    } catch {
      // ignore invalid JSON-LD
    }
  });

  const title = $('head > title').first().text().trim() || null;
  const description = attrContent($, 'meta[name="description"]');
  const canonical = $('link[rel="canonical"]').attr('href') ?? null;
  const htmlLang = $('html').attr('lang') ?? null;
  const charset =
    $('meta[charset]').attr('charset') ??
    $('meta[http-equiv="Content-Type"]')
      .attr('content')
      ?.match(/charset=([^;]+)/i)?.[1] ??
    null;
  const viewport = attrContent($, 'meta[name="viewport"]');
  const themeColor = attrContent($, 'meta[name="theme-color"]');
  const robotsMeta = attrContent($, 'meta[name="robots"]');
  const generator = attrContent($, 'meta[name="generator"]');

  return {
    title,
    metaDescription: description,
    canonical,
    htmlLang,
    charset,
    viewport,
    themeColor,
    robotsMeta,
    hreflangs,
    og,
    twitter,
    jsonLd,
    generator,
  };
}

function attrContent($: cheerio.CheerioAPI, selector: string): string | null {
  const v = $(selector).first().attr('content');
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function extractImages($: cheerio.CheerioAPI): ImageFacts {
  let total = 0;
  let withAlt = 0;
  let emptyAlt = 0;
  let lazyLoaded = 0;
  let withDimensions = 0;

  $('img').each((_, el) => {
    total += 1;
    const $el = $(el);
    const alt = $el.attr('alt');
    if (typeof alt === 'string') {
      if (alt.trim().length > 0) withAlt += 1;
      else emptyAlt += 1;
    }
    const loading = $el.attr('loading');
    if (loading === 'lazy') lazyLoaded += 1;
    if ($el.attr('width') && $el.attr('height')) withDimensions += 1;
  });

  return { total, withAlt, emptyAlt, lazyLoaded, withDimensions };
}

export function extractHeadings($: cheerio.CheerioAPI): HeadingFacts {
  const headings: { level: number; text: string }[] = [];
  $('h1, h2, h3, h4, h5, h6').each((_, el) => {
    const tag = 'tagName' in el ? el.tagName.toLowerCase() : '';
    const level = parseInt(tag.replace('h', ''), 10);
    if (Number.isFinite(level)) {
      const text = $(el).text().trim();
      headings.push({ level, text });
    }
  });

  const h1Texts = headings.filter((h) => h.level === 1).map((h) => h.text);
  let hierarchyBroken = false;
  let prevLevel = 0;
  for (const h of headings) {
    if (prevLevel > 0 && h.level > prevLevel + 1) {
      hierarchyBroken = true;
      break;
    }
    prevLevel = h.level;
  }

  return {
    h1Count: h1Texts.length,
    h1Texts,
    hierarchyBroken,
    headings: headings.slice(0, 200),
  };
}
