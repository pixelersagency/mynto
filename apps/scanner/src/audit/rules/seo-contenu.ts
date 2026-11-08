import type { AuditFacts, Finding } from '../types.js';

import { makeFinding, type RuleDefinition } from './types.js';

const BLOG_ABSENT: RuleDefinition = {
  code: 'seo_contenu.blog.absent',
  axis: 'seo_contenu',
  defaultSeverity: 'P1',
  defaultEffort: 'important',
  evaluate: ({ facts }) => {
    // Only fire when neither an internal nor an external blog is detected.
    // The external-only case is handled by BLOG_EXTERNAL_JUS_LOST below
    // (less severe : the content exists, it just feeds the wrong domain).
    if (facts.content.hasBlogSection) return null;
    return makeFinding(BLOG_ABSENT, {
      title: 'Aucune section blog ni contenu éditorial indexable',
      evidence: {},
    });
  },
};

const BLOG_EXTERNAL_JUS_LOST: RuleDefinition = {
  code: 'seo_contenu.blog.external_jus_lost',
  axis: 'seo_contenu',
  defaultSeverity: 'P2',
  defaultEffort: 'important',
  evaluate: ({ facts }) => {
    // Fire only when the site has an external blog AND no internal one :
    // the editorial authority earned by every published article goes to
    // a different domain (subdomain, founder personal site, Medium...)
    // instead of growing the main domain's topical reputation.
    if (!facts.content.hasExternalBlog) return null;
    // If there is also an internal blog, the external one is just a
    // satellite — not a problem on its own.
    if (facts.content.blogUrl !== facts.content.externalBlogUrl) return null;
    return makeFinding(BLOG_EXTERNAL_JUS_LOST, {
      title: 'Blog hébergé sur un domaine externe : autorité SEO perdue',
      evidence: { externalBlogUrl: facts.content.externalBlogUrl },
    });
  },
};

const THIN_HOME_CONTENT: RuleDefinition = {
  code: 'seo_contenu.home.thin',
  axis: 'seo_contenu',
  defaultSeverity: 'P2',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (facts.content.wordCount >= 250) return null;
    return makeFinding(THIN_HOME_CONTENT, {
      title: `Contenu très court sur la page d'accueil (${facts.content.wordCount.toString()} mots)`,
      evidence: { wordCount: facts.content.wordCount },
    });
  },
};

const READABILITY_HARD: RuleDefinition = {
  code: 'seo_contenu.readability.hard',
  axis: 'seo_contenu',
  defaultSeverity: 'P3',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    const f = facts.content.fleschScore;
    if (f === null || f >= 50) return null;
    return makeFinding(READABILITY_HARD, {
      title: `Lecture difficile (Flesch FR ≈ ${f.toString()})`,
      evidence: { flesch: f },
    });
  },
};

export const SEO_CONTENU_RULES: RuleDefinition[] = [
  BLOG_ABSENT,
  BLOG_EXTERNAL_JUS_LOST,
  THIN_HOME_CONTENT,
  READABILITY_HARD,
];

export function applySeoContenuRules(ctx: { facts: AuditFacts; origin: string }): Finding[] {
  const out: Finding[] = [];
  for (const rule of SEO_CONTENU_RULES) {
    const res = rule.evaluate(ctx);
    if (!res) continue;
    if (Array.isArray(res)) out.push(...res);
    else out.push(res);
  }
  return out;
}
