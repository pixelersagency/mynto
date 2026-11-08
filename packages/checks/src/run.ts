import { evaluateAccessibilite } from './axes/accessibilite.js';
import { evaluateConformite } from './axes/conformite.js';
import { evaluateConversion } from './axes/conversion.js';
import { evaluatePerformance } from './axes/performance.js';
import { evaluateSeoContenu } from './axes/seo-contenu.js';
import { evaluateSeoTechnique } from './axes/seo-technique.js';
import { evaluateUi } from './axes/ui.js';
import { evaluateUx } from './axes/ux.js';
import type { AuditAxis, AxisResult, ChecksReport, DomFacts } from './types.js';

/** Axis weights for the global score — mirror the scanner's business bias. */
const AXIS_WEIGHT: Record<AuditAxis, number> = {
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
 * Runs every axis evaluator against a DomFacts snapshot and rolls up a
 * weighted global score. Pure : same input -> same output, no DOM needed.
 */
export function runChecks(facts: DomFacts): ChecksReport {
  const axes: AxisResult[] = [
    evaluateSeoTechnique(facts),
    evaluateSeoContenu(facts),
    evaluatePerformance(facts),
    evaluateAccessibilite(facts),
    evaluateConformite(facts),
    evaluateConversion(facts),
    evaluateUx(facts),
    evaluateUi(facts),
  ];

  let weighted = 0;
  let totalWeight = 0;
  for (const a of axes) {
    const w = AXIS_WEIGHT[a.axis];
    weighted += a.score * w;
    totalWeight += w;
  }
  const globalScore = totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;

  return { url: facts.url, axes, globalScore };
}
