import type { AuditAxis, AuditFacts, AxisScore, Finding } from './types.js';

/**
 * Axis weights for the global score average. Tuned to reflect business
 * impact: conversion + SEO weigh more than UI/UX cosmetics. These map to
 * the same priorities as the `site-audit` skill.
 */
const AXIS_WEIGHTS: Record<AuditAxis, number> = {
  seo_technique: 1.2,
  seo_contenu: 0.8,
  performance: 1.0,
  accessibilite: 1.0,
  conformite: 1.0,
  conversion: 1.2,
  ux: 0.8,
  ui: 0.6,
};

/**
 * Per-axis 0-10 score. We start at 10 and subtract per finding by severity:
 *   P0 = -3, P1 = -1.5, P2 = -0.6, P3 = -0.2
 * Capped at 0. This gives a smooth gradient and reflects "one P0 ruins the axis".
 */
const SEVERITY_PENALTY: Record<Finding['severity'], number> = {
  P0: 3,
  P1: 1.5,
  P2: 0.6,
  P3: 0.2,
};

export const SCORED_AXES: readonly AuditAxis[] = [
  'seo_technique',
  'seo_contenu',
  'performance',
  'accessibilite',
  'conformite',
  'conversion',
  'ux',
  'ui',
];

/**
 * Scores of the enabled axes only. A disabled axis gets no entry at all
 * (never a 0): the global score is then the weighted mean of the axes that
 * were actually evaluated. With every axis enabled the output is unchanged.
 */
export function scoreAxes(
  findings: Finding[],
  enabledAxes: readonly AuditAxis[] = SCORED_AXES,
): AxisScore[] {
  const enabled = new Set(enabledAxes);
  const axes = SCORED_AXES.filter((a) => enabled.has(a));
  return axes.map((axis) => {
    // Only deterministic findings move the mechanical score. Qualitative
    // (vision/judgment) findings are expert analysis that justifies a
    // redesign; costing them into the same 0-10 score is exactly the
    // "LLM acts as judge" behaviour this design avoids. They are
    // surfaced separately, never as a numeric penalty.
    const subset = findings.filter(
      (f) => f.axis === axis && f.kind === 'deterministic' && f.advisory !== true,
    );
    let score = 10;
    for (const f of subset) {
      score -= SEVERITY_PENALTY[f.severity];
    }
    if (score < 0) score = 0;
    score = Math.round(score * 10) / 10;
    return {
      axis,
      score,
      band: bandFromScore(score),
      weight: AXIS_WEIGHTS[axis],
    };
  });
}

/**
 * Missing heavy collectors cannot certify an axis as healthy. Keep all
 * deterministic findings, but withhold the aggregate until its main
 * collector is available. UI/UX/conversion DOM checks still run and their
 * findings remain in the report; missing vision does not erase them.
 */
export function evaluatedAxisScores(scores: AxisScore[], facts: AuditFacts): AxisScore[] {
  return scores.filter(({ axis }) => {
    if (axis === 'performance') {
      const value = facts.lighthouse.performance;
      return (
        facts.lighthouse.fetched &&
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 1
      );
    }
    if (axis === 'accessibilite') return facts.axe.fetched;
    if (axis === 'ui' || axis === 'ux' || axis === 'conversion') {
      return facts.vision.fetched;
    }
    return true;
  });
}

function bandFromScore(score: number): AxisScore['band'] {
  if (score >= 9) return 'excellent';
  if (score >= 7) return 'good';
  if (score >= 5) return 'fair';
  if (score >= 3) return 'poor';
  return 'critical';
}
