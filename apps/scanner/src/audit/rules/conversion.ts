import type { AuditFacts, Finding } from '../types.js';

import { makeFinding, type RuleDefinition } from './types.js';

const PRICING_ANCHOR_ONLY: RuleDefinition = {
  code: 'conversion.pricing.anchor_only',
  axis: 'conversion',
  defaultSeverity: 'P1',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (!facts.conversion.pricingIsAnchorOnly) return null;
    return makeFinding(PRICING_ANCHOR_ONLY, {
      title: 'Tarifs accessibles uniquement via une ancre, pas de page /pricing dédiée',
      evidence: {},
    });
  },
};

const TESTIMONIALS_THIN: RuleDefinition = {
  code: 'conversion.testimonials.thin',
  axis: 'conversion',
  defaultSeverity: 'P2',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    const c = facts.conversion;
    const v = facts.vision;
    // If the vision pipeline confirms visible testimonials on the
    // rendered page, trust it over the HTML-only count. This kills the
    // class of false positives where the page truly has named cards
    // (plain-div pattern) but the markup uses generic divs the regex
    // cannot recognise.
    const visibleCount = v.fetched ? v.visibleTestimonials : 0;
    const visibleNamed = v.fetched && v.visibleTestimonialsHaveNamedAuthor;
    const totalCount = Math.max(c.testimonialsCount, visibleCount);

    if (totalCount === 0) {
      return makeFinding(TESTIMONIALS_THIN, {
        title: 'Aucun témoignage client visible',
        evidence: { visionFetched: v.fetched },
        severity: 'P1',
      });
    }
    // "Without name or photo" only fires when neither the HTML signals
    // nor the vision LLM see a named author : if the LLM confirms a
    // named testimonial, the user is fine even if our regex couldn't
    // match the markup.
    const anyNamed = c.testimonialsHaveName || visibleNamed;
    const anyPhoto = c.testimonialsHavePhoto || (v.fetched && v.visibleTestimonials > 0);
    if (!anyNamed || !anyPhoto) {
      return makeFinding(TESTIMONIALS_THIN, {
        title: 'Témoignages présents mais sans nom complet ou photo',
        evidence: {
          htmlCount: c.testimonialsCount,
          visibleCount,
          hasName: anyNamed,
          hasPhoto: anyPhoto,
        },
      });
    }
    return null;
  },
};

const CTA_LOW_CONTRAST_VISUAL: RuleDefinition = {
  code: 'conversion.cta.low_contrast_visual',
  axis: 'conversion',
  defaultSeverity: 'P2',
  defaultEffort: 'quick_win',
  kind: 'qualitative',
  evaluate: ({ facts }) => {
    if (!facts.vision.fetched) return null;
    if (facts.vision.ctaContrastIssue !== true) return null;
    return makeFinding(CTA_LOW_CONTRAST_VISUAL, {
      title: 'CTA principal faible : contraste insuffisant avec son fond (analyse visuelle)',
      evidence: {
        verdict: facts.vision.overallVerdict,
        model: facts.vision.model,
      },
    });
  },
};

const NO_CTA_ABOVE_FOLD: RuleDefinition = {
  code: 'conversion.cta.not_above_fold',
  axis: 'conversion',
  defaultSeverity: 'P1',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (facts.conversion.ctaAboveFold) return null;
    if (facts.conversion.ctaCount === 0) {
      return makeFinding(NO_CTA_ABOVE_FOLD, {
        title: 'Aucun call-to-action explicite détecté',
        evidence: {},
      });
    }
    return makeFinding(NO_CTA_ABOVE_FOLD, {
      title: 'Aucun call-to-action visible above the fold',
      evidence: { totalCtas: facts.conversion.ctaCount },
    });
  },
};

const CONTACT_THIN: RuleDefinition = {
  code: 'conversion.contact.thin',
  axis: 'conversion',
  defaultSeverity: 'P2',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    const c = facts.conversion;
    if (c.contactHasPhone || c.contactHasForm || c.contactHasWhatsApp) return null;
    return makeFinding(CONTACT_THIN, {
      title: 'Aucun canal de contact direct (téléphone, formulaire, WhatsApp)',
      evidence: {
        hasEmail: c.contactHasEmail,
        contactUrl: c.contactUrl,
      },
    });
  },
};

const COPY_GENERIC: RuleDefinition = {
  code: 'conversion.copy.generic',
  axis: 'conversion',
  defaultSeverity: 'P1',
  defaultEffort: 'important',
  kind: 'qualitative',
  evaluate: ({ facts }) => {
    if (!facts.vision.fetched) return null;
    const c = facts.vision.valuePropClarity;
    if (c !== 'vague' && c !== 'absent') return null;
    return makeFinding(COPY_GENERIC, {
      title:
        c === 'absent'
          ? 'Pas de proposition de valeur visible sur la home'
          : 'Proposition de valeur trop générique / floue',
      evidence: {
        clarity: c,
        verdict: facts.vision.copyVerdict,
        issues: facts.vision.copyToneIssues,
        model: facts.vision.model,
      },
    });
  },
};

const COPY_NO_PROOF: RuleDefinition = {
  code: 'conversion.copy.no_proof',
  axis: 'conversion',
  defaultSeverity: 'P2',
  defaultEffort: 'standard',
  kind: 'qualitative',
  evaluate: ({ facts }) => {
    if (!facts.vision.fetched) return null;
    const issues = facts.vision.copyToneIssues;
    // Trigger only on issues that explicitly name a missing proof / weak
    // claim. Keeps the rule from firing on cosmetic copy nits.
    const proofIssues = issues.filter((it) =>
      /(preuve|chiffr|donn[ée]e|exemple|cas client|verbe faible|trop g[ée]n[ée]rique)/i.test(it),
    );
    if (proofIssues.length === 0) return null;
    return makeFinding(COPY_NO_PROOF, {
      title: `Copywriting peu convaincant : ${proofIssues[0] ?? ''}`,
      evidence: {
        proofIssues,
        verdict: facts.vision.copyVerdict,
        model: facts.vision.model,
      },
    });
  },
};

export const CONVERSION_RULES: RuleDefinition[] = [
  PRICING_ANCHOR_ONLY,
  TESTIMONIALS_THIN,
  CTA_LOW_CONTRAST_VISUAL,
  NO_CTA_ABOVE_FOLD,
  CONTACT_THIN,
  COPY_GENERIC,
  COPY_NO_PROOF,
];

export function applyConversionRules(ctx: { facts: AuditFacts; origin: string }): Finding[] {
  const out: Finding[] = [];
  for (const rule of CONVERSION_RULES) {
    const res = rule.evaluate(ctx);
    if (!res) continue;
    if (Array.isArray(res)) out.push(...res);
    else out.push(res);
  }
  return out;
}
