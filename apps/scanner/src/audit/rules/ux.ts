import type { DesignMeasurements } from '../collectors/design-measurements.js';
import type { AuditFacts, Finding } from '../types.js';

import { makeFinding, type RuleDefinition } from './types.js';

const MOBILE_VIEWPORT_MISSING: RuleDefinition = {
  code: 'ux.viewport.missing',
  axis: 'ux',
  defaultSeverity: 'P0',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    if (facts.ux.hasMobileViewport) return null;
    return makeFinding(MOBILE_VIEWPORT_MISSING, {
      title: 'Viewport mobile absent (width=device-width manquant)',
      evidence: { viewport: facts.meta.viewport },
    });
  },
};

const NAV_TOO_DEEP: RuleDefinition = {
  code: 'ux.nav.empty',
  advisory: true,
  axis: 'ux',
  defaultSeverity: 'P2',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (facts.ux.navItemsCount > 0) return null;
    return makeFinding(NAV_TOO_DEEP, {
      title: 'Aucun lien dans un élément nav du HTML analysé, navigation rendue à vérifier',
      evidence: {},
    });
  },
};

// --- Vision-driven UX rules --------------------------------------------
// Short-circuit when vision.fetched=false so a missing API key never
// produces a false positive.
//
// NOTE: ux.navigation.unclear used to threshold a free 0-10 vision score.
// It is now generated from the closed grid (criterion `navigation_clarte`)
// in ./grid-rules.ts, firing only on a `probleme` rating.

const UX_FRICTION_DETECTED: RuleDefinition = {
  code: 'ux.friction.detected',
  axis: 'ux',
  defaultSeverity: 'P2',
  defaultEffort: 'standard',
  kind: 'qualitative',
  evaluate: ({ facts }) => {
    if (!facts.vision.fetched) return null;
    const points = facts.vision.uxFrictionPoints;
    if (points.length === 0) return null;
    return makeFinding(UX_FRICTION_DETECTED, {
      title: `${points.length.toString()} friction(s) UX visibles : ${points[0] ?? ''}`,
      evidence: {
        frictionPoints: points,
        verdict: facts.vision.uxVerdict,
        model: facts.vision.model,
      },
    });
  },
};

/** Rendered observations stay deterministic, but advisory: neither a
 * sampled overflow nor a small target alone proves a WCAG failure. */
const HORIZONTAL_OVERFLOW: RuleDefinition = {
  code: 'ux.layout.horizontal_overflow',
  axis: 'ux',
  advisory: true,
  defaultSeverity: 'P3',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    const measurements = (facts as AuditFacts & { designMeasurements?: DesignMeasurements })
      .designMeasurements;
    return (measurements?.viewports ?? [])
      .filter((sample) => sample.horizontalOverflowPx > 1)
      .map((sample) =>
        makeFinding(HORIZONTAL_OVERFLOW, {
          title: `Débordement horizontal mesuré (${sample.viewport}, ${String(Math.round(sample.horizontalOverflowPx))} px)`,
          affectedUrls: [facts.url],
          evidence: {
            ...sample,
            textSamples: undefined,
            smallTargets: undefined,
            advisory: true,
            scope:
              'Document principal, éléments échantillonnés dans les 2400 premiers pixels CSS. Les zones à défilement volontaire ne constituent pas automatiquement un défaut.',
          },
        }),
      );
  },
};

const SMALL_CROWDED_TARGETS: RuleDefinition = {
  code: 'ux.targets.small_crowded',
  axis: 'ux',
  advisory: true,
  defaultSeverity: 'P3',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    const measurements = (facts as AuditFacts & { designMeasurements?: DesignMeasurements })
      .designMeasurements;
    return (measurements?.viewports ?? []).flatMap((sample) => {
      // Missing neighboring targets can invalidate spacing conclusions.
      if (sample.truncated) return [];
      const targets = sample.smallTargets.filter(
        (target) => !target.spacingException && !target.inlineException,
      );
      if (!targets.length) return [];
      return [
        makeFinding(SMALL_CROWDED_TARGETS, {
          title: `${String(targets.length)} petite(s) cible(s) rapprochée(s) observée(s) (${sample.viewport})`,
          affectedUrls: [facts.url],
          evidence: {
            viewport: sample.viewport,
            width: sample.width,
            height: sample.height,
            thresholdCssPx: 24,
            targets,
            advisory: true,
            scope:
              'Observation géométrique, pas un verdict WCAG. Exceptions de contrôle équivalent, présentation essentielle et contrôle natif non vérifiées. Aucun clic testé.',
          },
        }),
      ];
    });
  },
};

export const UX_RULES: RuleDefinition[] = [
  HORIZONTAL_OVERFLOW,
  SMALL_CROWDED_TARGETS,
  MOBILE_VIEWPORT_MISSING,
  NAV_TOO_DEEP,
  UX_FRICTION_DETECTED,
];

export function applyUxRules(ctx: { facts: AuditFacts; origin: string }): Finding[] {
  const out: Finding[] = [];
  for (const rule of UX_RULES) {
    const res = rule.evaluate(ctx);
    if (!res) continue;
    if (Array.isArray(res)) out.push(...res);
    else out.push(res);
  }
  return out;
}
