import type { AuditFacts, Finding, LegalRef } from '../types.js';

import { makeFinding, type RuleDefinition } from './types.js';

const WCAG_1_4_4: LegalRef = {
  standard: 'WCAG',
  version: '2.1',
  criterion: '1.4.4',
  label: 'WCAG 2.1 — 1.4.4 Resize text',
  url: 'https://www.w3.org/WAI/WCAG21/Understanding/resize-text.html',
};
const RGAA_10_4: LegalRef = {
  standard: 'RGAA',
  version: '4.1',
  criterion: '10.4',
  label: 'RGAA 4.1 — critère 10.4',
  url: 'https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#10.4',
};
const RGAA_8_3: LegalRef = {
  standard: 'RGAA',
  version: '4.1',
  criterion: '8.3',
  label: 'RGAA 4.1 — critère 8.3 (langue par défaut)',
  url: 'https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#8.3',
};
const WCAG_3_1_1: LegalRef = {
  standard: 'WCAG',
  version: '2.1',
  criterion: '3.1.1',
  label: 'WCAG 2.1 — 3.1.1 Language of Page',
  url: 'https://www.w3.org/WAI/WCAG21/Understanding/language-of-page.html',
};
const RGAA_1_1: LegalRef = {
  standard: 'RGAA',
  version: '4.1',
  criterion: '1.1',
  label: 'RGAA 4.1 — critère 1.1 (alternative textuelle aux images)',
  url: 'https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.1',
};
const WCAG_1_1_1: LegalRef = {
  standard: 'WCAG',
  version: '2.1',
  criterion: '1.1.1',
  label: 'WCAG 2.1 — 1.1.1 Non-text Content',
  url: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html',
};
/**
 * Generic WCAG 2.1 AA reference for findings detected by axe-core that
 * span multiple criteria (color contrast 1.4.3, ARIA usage 4.1.2, focus
 * order 2.4.3, etc.). Hardcoding a single criterion (e.g. 1.1.1) on every
 * axe violation is misleading — DSI/RSE prospects who know WCAG by heart
 * would catch the inconsistency instantly. The full criterion mapping per
 * axe ruleId lives in the evidence payload (rules[].id).
 */
const WCAG_2_1_AA_GENERIC: LegalRef = {
  standard: 'WCAG',
  version: '2.1',
  label: 'WCAG 2.1 niveau AA (critère exact selon ruleId axe-core dans evidence)',
  url: 'https://www.w3.org/WAI/WCAG21/quickref/?levels=aa',
};
const EAA_GENERAL: LegalRef = {
  standard: 'EAA',
  label: 'European Accessibility Act (Directive 2019/882) — applicable depuis le 28 juin 2025',
  url: 'https://eur-lex.europa.eu/eli/dir/2019/882/oj',
};

const VIEWPORT_BLOCKS_ZOOM: RuleDefinition = {
  code: 'a11y.viewport.blocks_zoom',
  axis: 'accessibilite',
  defaultSeverity: 'P0',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    if (!facts.ux.viewportBlocksZoom) return null;
    return makeFinding(VIEWPORT_BLOCKS_ZOOM, {
      title: 'Viewport bloque le zoom (user-scalable=no ou maximum-scale=1)',
      evidence: { viewport: facts.meta.viewport },
      legalRefs: [WCAG_1_4_4, RGAA_10_4, EAA_GENERAL],
    });
  },
};

const HTML_LANG_MISSING: RuleDefinition = {
  code: 'a11y.html_lang.missing',
  axis: 'accessibilite',
  defaultSeverity: 'P1',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    if (facts.meta.htmlLang) return null;
    return makeFinding(HTML_LANG_MISSING, {
      title: 'Attribut lang absent sur <html>',
      evidence: {},
      legalRefs: [WCAG_3_1_1, RGAA_8_3],
    });
  },
};

const IMAGES_MISSING_ALT: RuleDefinition = {
  code: 'a11y.images.missing_alt',
  axis: 'accessibilite',
  defaultSeverity: 'P1',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    const { total, withAlt, emptyAlt } = facts.images;
    if (total === 0) return null;
    const documented = withAlt + emptyAlt;
    if (documented >= total * 0.9) return null;
    const missing = total - documented;
    return makeFinding(IMAGES_MISSING_ALT, {
      title: `${missing.toString()} image(s) sans attribut alt sur ${total.toString()}`,
      evidence: { total, withAlt, emptyAlt, missing },
      legalRefs: [WCAG_1_1_1, RGAA_1_1, EAA_GENERAL],
    });
  },
};

const SKIP_LINK_MISSING: RuleDefinition = {
  code: 'a11y.skip_link.missing',
  axis: 'accessibilite',
  defaultSeverity: 'P2',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    if (facts.ux.hasSkipLink) return null;
    return makeFinding(SKIP_LINK_MISSING, {
      title: 'Pas de lien d\'évitement "Aller au contenu principal"',
      evidence: {},
      legalRefs: [RGAA_10_4],
    });
  },
};

const AXE_CRITICAL: RuleDefinition = {
  code: 'a11y.axe.critical',
  axis: 'accessibilite',
  defaultSeverity: 'P0',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (!facts.axe.fetched) return null;
    const critical = facts.axe.violations.filter((v) => v.impact === 'critical');
    if (critical.length === 0) return null;
    return makeFinding(AXE_CRITICAL, {
      title: `${critical.length.toString()} violation(s) WCAG critique(s) détectée(s) par axe-core`,
      evidence: {
        rules: critical.slice(0, 10).map((v) => ({ id: v.ruleId, nodes: v.nodes })),
      },
      legalRefs: [WCAG_2_1_AA_GENERIC, EAA_GENERAL],
    });
  },
};

const AXE_SERIOUS: RuleDefinition = {
  code: 'a11y.axe.serious',
  axis: 'accessibilite',
  defaultSeverity: 'P1',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (!facts.axe.fetched) return null;
    const serious = facts.axe.violations.filter((v) => v.impact === 'serious');
    if (serious.length === 0) return null;
    return makeFinding(AXE_SERIOUS, {
      title: `${serious.length.toString()} violation(s) WCAG sérieuse(s) détectée(s) par axe-core`,
      evidence: {
        rules: serious.slice(0, 10).map((v) => ({ id: v.ruleId, nodes: v.nodes })),
      },
      legalRefs: [WCAG_2_1_AA_GENERIC],
    });
  },
};

const LIGHTHOUSE_A11Y_LOW: RuleDefinition = {
  code: 'a11y.lighthouse.low',
  axis: 'accessibilite',
  defaultSeverity: 'P1',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (!facts.lighthouse.fetched) return null;
    const score = facts.lighthouse.accessibility;
    if (score === null || score >= 0.9) return null;
    return makeFinding(LIGHTHOUSE_A11Y_LOW, {
      title: `Score Lighthouse accessibilité bas (${Math.round(score * 100).toString()}/100)`,
      evidence: { score },
      legalRefs: [WCAG_1_1_1, EAA_GENERAL],
    });
  },
};

export const A11Y_RULES: RuleDefinition[] = [
  VIEWPORT_BLOCKS_ZOOM,
  HTML_LANG_MISSING,
  IMAGES_MISSING_ALT,
  SKIP_LINK_MISSING,
  AXE_CRITICAL,
  AXE_SERIOUS,
  LIGHTHOUSE_A11Y_LOW,
];

export function applyAccessibiliteRules(ctx: { facts: AuditFacts; origin: string }): Finding[] {
  const out: Finding[] = [];
  for (const rule of A11Y_RULES) {
    const res = rule.evaluate(ctx);
    if (!res) continue;
    if (Array.isArray(res)) out.push(...res);
    else out.push(res);
  }
  return out;
}
