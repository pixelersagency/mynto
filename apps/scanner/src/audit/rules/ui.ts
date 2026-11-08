import type { AuditFacts, Finding } from '../types.js';

import { makeFinding, type RuleDefinition } from './types.js';

const INLINE_STYLES_HEAVY: RuleDefinition = {
  code: 'ui.inline_styles.heavy',
  advisory: true,
  axis: 'ui',
  defaultSeverity: 'P3',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (facts.ui.inlineStylesBytes < 20_000) return null;
    return makeFinding(INLINE_STYLES_HEAVY, {
      title: `Volume de styles inline (${Math.round(facts.ui.inlineStylesBytes / 1024).toString()} KB)`,
      evidence: { bytes: facts.ui.inlineStylesBytes },
    });
  },
};

const TOO_MANY_FONTS: RuleDefinition = {
  code: 'ui.fonts.too_many',
  advisory: true,
  axis: 'ui',
  defaultSeverity: 'P3',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (facts.ui.fontFamiliesCount < 4) return null;
    return makeFinding(TOO_MANY_FONTS, {
      title: `${facts.ui.fontFamiliesCount.toString()} familles de polices détectées`,
      evidence: { count: facts.ui.fontFamiliesCount },
    });
  },
};

// Legacy HTML/stack markers are factual observations. Their presence does
// not establish a usability defect, require a redesign or justify a score penalty.
const TECH_OUTDATED: RuleDefinition = {
  code: 'ui.tech.outdated',
  advisory: true,
  axis: 'ui',
  defaultSeverity: 'P1',
  defaultEffort: 'important',
  // Deterministic: every reason is a hard fact parsed from the served HTML.
  evaluate: ({ facts }) => {
    if (!facts.techAge.isDated) return null;
    return makeFinding(TECH_OUTDATED, {
      title: 'Marqueurs techniques anciens détectés, impact visuel non établi',
      evidence: {
        reasons: facts.techAge.reasons,
        jqueryVersion: facts.techAge.jqueryVersion,
        bootstrapMajor: facts.techAge.bootstrapMajor,
        layoutTables: facts.techAge.layoutTablesCount,
        deprecatedTags: facts.techAge.deprecatedTags,
        flash: facts.techAge.flashEmbedDetected,
        legacyDoctype: facts.techAge.legacyDoctype,
      },
    });
  },
};

// --- Vision-driven rules --------------------------------------------------
// Each rule MUST short-circuit when `facts.vision.fetched === false` so a
// missing API key, screenshot failure, or LLM timeout never produces a
// false positive. The vision facts are an additive layer on top of the
// HTML-only collectors, never a replacement.

const HERO_CONFUSED: RuleDefinition = {
  code: 'ui.hero.confused',
  axis: 'ui',
  defaultSeverity: 'P1',
  defaultEffort: 'important',
  kind: 'qualitative',
  evaluate: ({ facts }) => {
    if (!facts.vision.fetched) return null;
    if (facts.vision.heroHasClearValue !== false) return null;
    return makeFinding(HERO_CONFUSED, {
      title: "Hero confus : la proposition de valeur n'est pas claire au premier écran",
      evidence: {
        issues: facts.vision.heroIssues,
        verdict: facts.vision.overallVerdict,
        model: facts.vision.model,
      },
    });
  },
};

// NOTE: the former free-score UI rules (ui.visual_hierarchy.weak,
// ui.design.dated_for_sector, ui.brand.inconsistent) used to threshold a
// 0-10 vision score — the LLM acting as judge. They are now generated from
// the closed grid in ./grid-rules.ts (same rule codes), which fires only on
// a `probleme` rating with a mandatory justification.

export const UI_RULES: RuleDefinition[] = [
  INLINE_STYLES_HEAVY,
  TOO_MANY_FONTS,
  TECH_OUTDATED,
  HERO_CONFUSED,
];

export function applyUiRules(ctx: { facts: AuditFacts; origin: string }): Finding[] {
  const out: Finding[] = [];
  for (const rule of UI_RULES) {
    const res = rule.evaluate(ctx);
    if (!res) continue;
    if (Array.isArray(res)) out.push(...res);
    else out.push(res);
  }
  return out;
}
