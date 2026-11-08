import type { AuditFacts, Finding, LegalRef } from '../types.js';

import { makeFinding, type RuleDefinition } from './types.js';

const GOOGLE_REF_TITLE: LegalRef = {
  standard: 'GOOGLE',
  label: 'Google Search Central — Title link',
  url: 'https://developers.google.com/search/docs/appearance/title-link',
};
const GOOGLE_REF_DESC: LegalRef = {
  standard: 'GOOGLE',
  label: 'Google Search Central — Snippet',
  url: 'https://developers.google.com/search/docs/appearance/snippet',
};
const GOOGLE_REF_SITEMAP: LegalRef = {
  standard: 'GOOGLE',
  label: 'Google Search Central — Sitemaps',
  url: 'https://developers.google.com/search/docs/crawling-indexing/sitemaps/overview',
};
const GOOGLE_REF_STRUCTURED: LegalRef = {
  standard: 'GOOGLE',
  label: 'Google Search Central — Structured data',
  url: 'https://developers.google.com/search/docs/appearance/structured-data',
};
const GOOGLE_REF_CANONICAL: LegalRef = {
  standard: 'GOOGLE',
  label: 'Google Search Central — Canonicalization',
  url: 'https://developers.google.com/search/docs/crawling-indexing/canonicalization',
};

const SITEMAP_MISSING: RuleDefinition = {
  code: 'seo.sitemap.missing',
  axis: 'seo_technique',
  defaultSeverity: 'P0',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    if (facts.sitemap.found) return null;
    return makeFinding(SITEMAP_MISSING, {
      title: 'Sitemap.xml introuvable',
      evidence: {
        triedLocations: facts.sitemap.triedLocations,
        declaredInRobots: facts.sitemap.declaredInRobots,
      },
      legalRefs: [GOOGLE_REF_SITEMAP],
    });
  },
};

const SITEMAP_NOT_IN_ROBOTS: RuleDefinition = {
  code: 'seo.sitemap.not_declared_in_robots',
  axis: 'seo_technique',
  defaultSeverity: 'P2',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    if (!facts.sitemap.found) return null;
    if (facts.sitemap.declaredInRobots) return null;
    return makeFinding(SITEMAP_NOT_IN_ROBOTS, {
      title: 'Sitemap non déclaré dans robots.txt',
      evidence: { sitemapFoundAt: facts.sitemap.foundAt },
      legalRefs: [GOOGLE_REF_SITEMAP],
    });
  },
};

const TITLE_MISSING: RuleDefinition = {
  code: 'seo.title.missing',
  axis: 'seo_technique',
  defaultSeverity: 'P0',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    if (facts.meta.title) return null;
    return makeFinding(TITLE_MISSING, {
      title: 'Balise <title> absente',
      evidence: {},
      legalRefs: [GOOGLE_REF_TITLE],
    });
  },
};

const TITLE_TOO_LONG: RuleDefinition = {
  code: 'seo.title.too_long',
  axis: 'seo_technique',
  defaultSeverity: 'P2',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    const t = facts.meta.title;
    if (!t || t.length <= 60) return null;
    return makeFinding(TITLE_TOO_LONG, {
      title: `Title trop long (${t.length.toString()} caractères)`,
      evidence: { title: t, length: t.length },
      legalRefs: [GOOGLE_REF_TITLE],
    });
  },
};

const META_DESCRIPTION_MISSING: RuleDefinition = {
  code: 'seo.meta_description.missing',
  axis: 'seo_technique',
  defaultSeverity: 'P1',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    if (facts.meta.metaDescription) return null;
    return makeFinding(META_DESCRIPTION_MISSING, {
      title: 'Meta description absente',
      evidence: {},
      legalRefs: [GOOGLE_REF_DESC],
    });
  },
};

const META_DESCRIPTION_TOO_LONG: RuleDefinition = {
  code: 'seo.meta_description.too_long',
  axis: 'seo_technique',
  defaultSeverity: 'P2',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    const d = facts.meta.metaDescription;
    if (!d || d.length <= 160) return null;
    return makeFinding(META_DESCRIPTION_TOO_LONG, {
      title: `Meta description trop longue (${d.length.toString()} caractères)`,
      evidence: { description: d, length: d.length },
      legalRefs: [GOOGLE_REF_DESC],
    });
  },
};

const OG_IMAGE_MISSING: RuleDefinition = {
  code: 'seo.og_image.missing',
  axis: 'seo_technique',
  defaultSeverity: 'P1',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    if (facts.meta.og['og:image']) return null;
    return makeFinding(OG_IMAGE_MISSING, {
      title: 'og:image absente (partages sociaux sans aperçu)',
      evidence: { og: facts.meta.og },
      legalRefs: [],
    });
  },
};

const TWITTER_CARD_SUMMARY_SMALL: RuleDefinition = {
  code: 'seo.twitter_card.summary_small',
  axis: 'seo_technique',
  defaultSeverity: 'P2',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    const card = facts.meta.twitter['twitter:card'];
    if (!card) {
      return makeFinding(TWITTER_CARD_SUMMARY_SMALL, {
        title: 'twitter:card absente',
        evidence: {},
      });
    }
    if (card.toLowerCase() === 'summary') {
      return makeFinding(TWITTER_CARD_SUMMARY_SMALL, {
        title: 'twitter:card en "summary" au lieu de "summary_large_image"',
        evidence: { current: card },
      });
    }
    return null;
  },
};

const JSON_LD_ABSENT: RuleDefinition = {
  code: 'seo.json_ld.absent',
  axis: 'seo_technique',
  defaultSeverity: 'P1',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (facts.meta.jsonLd.length > 0) return null;
    return makeFinding(JSON_LD_ABSENT, {
      title: 'Aucune donnée structurée JSON-LD',
      evidence: {},
      legalRefs: [GOOGLE_REF_STRUCTURED],
    });
  },
};

const CANONICAL_POINTS_TO_HOME: RuleDefinition = {
  code: 'seo.canonical.points_to_home',
  axis: 'seo_technique',
  defaultSeverity: 'P0',
  defaultEffort: 'quick_win',
  evaluate: ({ facts, origin }) => {
    const c = facts.meta.canonical;
    if (!c) return null;
    try {
      const canonicalUrl = new URL(c, origin).toString().replace(/\/$/, '');
      const homeUrl = origin.replace(/\/$/, '');
      const pageUrl = facts.http.finalUrl.replace(/\/$/, '');
      if (pageUrl !== homeUrl && canonicalUrl === homeUrl) {
        return makeFinding(CANONICAL_POINTS_TO_HOME, {
          title: 'Canonical pointe vers la home depuis une autre page',
          evidence: { canonical: c, pageUrl, homeUrl },
          legalRefs: [GOOGLE_REF_CANONICAL],
        });
      }
    } catch {
      // ignore
    }
    return null;
  },
};

const H1_MISSING_OR_MULTIPLE: RuleDefinition = {
  code: 'seo.h1.missing_or_multiple',
  axis: 'seo_technique',
  defaultSeverity: 'P1',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    const count = facts.headings.h1Count;
    if (count === 1) return null;
    const title =
      count === 0 ? 'Aucun H1 sur la page' : `${count.toString()} balises H1 sur la même page`;
    return makeFinding(H1_MISSING_OR_MULTIPLE, {
      title,
      evidence: { h1Count: count, h1Texts: facts.headings.h1Texts.slice(0, 5) },
    });
  },
};

const HEADINGS_HIERARCHY_BROKEN: RuleDefinition = {
  code: 'seo.headings.hierarchy_broken',
  axis: 'seo_technique',
  defaultSeverity: 'P2',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (!facts.headings.hierarchyBroken) return null;
    return makeFinding(HEADINGS_HIERARCHY_BROKEN, {
      title: 'Hiérarchie des titres incohérente',
      evidence: { sample: facts.headings.headings.slice(0, 12) },
    });
  },
};

const FAKE_ONE_PAGE: RuleDefinition = {
  code: 'seo.fake_one_page',
  axis: 'seo_technique',
  defaultSeverity: 'P2',
  defaultEffort: 'important',
  evaluate: ({ facts }) => {
    if (!facts.fakeOnePageDetected) return null;
    const sample = facts.internalPagesCrawled.slice(0, 5);
    const evidence = { sample, renderCheck: facts.fakeOnePageRenderCheck };

    // Rendered DOM also identical -> genuine fake one-page. Keep the P0.
    if (facts.fakeOnePageRenderCheck === 'identical') {
      return makeFinding(FAKE_ONE_PAGE, {
        severity: 'P0',
        title: 'Toutes les URLs internes retournent le même contenu (fake one-page)',
        evidence,
        legalRefs: [GOOGLE_REF_CANONICAL],
      });
    }

    // Rendered DOM differs -> site is JS-rendered, not a scam one-pager. The
    // raw HTML being identical is still a (minor) SEO/robustness concern.
    if (facts.fakeOnePageRenderCheck === 'distinct') {
      return makeFinding(FAKE_ONE_PAGE, {
        severity: 'P2',
        title: 'Contenu des pages internes injecté en JavaScript (invisible sans JS)',
        evidence,
        legalRefs: [GOOGLE_REF_CANONICAL],
      });
    }

    // Could not render-verify: do not assert a P0 on raw HTML alone.
    return makeFinding(FAKE_ONE_PAGE, {
      severity: 'P2',
      title: 'Pages internes au contenu HTML identique (à vérifier manuellement)',
      evidence,
      legalRefs: [GOOGLE_REF_CANONICAL],
    });
  },
};

const HREFLANG_MISSING_FOR_MULTILANG: RuleDefinition = {
  code: 'seo.hreflang.missing',
  axis: 'seo_technique',
  defaultSeverity: 'P2',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (facts.meta.hreflangs.length > 0) return null;
    const hasLangSlug = /\/(fr|en|de|es|it|nl|pt|ar)(\/|$)/i.test(facts.http.finalUrl);
    if (!hasLangSlug) return null;
    return makeFinding(HREFLANG_MISSING_FOR_MULTILANG, {
      title: 'URL avec préfixe langue mais hreflang absent',
      evidence: { url: facts.http.finalUrl },
    });
  },
};

const HTTPS_MISSING: RuleDefinition = {
  code: 'seo.https.missing',
  axis: 'seo_technique',
  defaultSeverity: 'P0',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (facts.http.isHttps) return null;
    return makeFinding(HTTPS_MISSING, {
      title: 'Site servi sans HTTPS',
      evidence: { finalUrl: facts.http.finalUrl },
    });
  },
};

const ROBOTS_BLOCKS_AI_BOTS: RuleDefinition = {
  code: 'seo.robots.blocks_ai_bots',
  axis: 'seo_technique',
  defaultSeverity: 'P2',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    if (facts.robots.blocksAiBots.length === 0) return null;
    return makeFinding(ROBOTS_BLOCKS_AI_BOTS, {
      title: 'robots.txt bloque les bots IA (ChatGPT, Claude, Perplexity)',
      evidence: { bots: facts.robots.blocksAiBots },
    });
  },
};

const ROBOTS_DISALLOW_ALL: RuleDefinition = {
  code: 'seo.robots.disallow_all',
  axis: 'seo_technique',
  defaultSeverity: 'P0',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    if (!facts.robots.hasDisallowAll) return null;
    return makeFinding(ROBOTS_DISALLOW_ALL, {
      title: 'robots.txt interdit le crawl complet du site',
      evidence: { content: facts.robots.content?.slice(0, 200) },
    });
  },
};

export const SEO_TECHNIQUE_RULES: RuleDefinition[] = [
  HTTPS_MISSING,
  FAKE_ONE_PAGE,
  ROBOTS_DISALLOW_ALL,
  SITEMAP_MISSING,
  SITEMAP_NOT_IN_ROBOTS,
  TITLE_MISSING,
  TITLE_TOO_LONG,
  META_DESCRIPTION_MISSING,
  META_DESCRIPTION_TOO_LONG,
  OG_IMAGE_MISSING,
  TWITTER_CARD_SUMMARY_SMALL,
  JSON_LD_ABSENT,
  CANONICAL_POINTS_TO_HOME,
  H1_MISSING_OR_MULTIPLE,
  HEADINGS_HIERARCHY_BROKEN,
  HREFLANG_MISSING_FOR_MULTILANG,
  ROBOTS_BLOCKS_AI_BOTS,
];

export function applySeoTechniqueRules(ctx: { facts: AuditFacts; origin: string }): Finding[] {
  const out: Finding[] = [];
  for (const rule of SEO_TECHNIQUE_RULES) {
    const res = rule.evaluate(ctx);
    if (!res) continue;
    if (Array.isArray(res)) out.push(...res);
    else out.push(res);
  }
  return out;
}
