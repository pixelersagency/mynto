import { GRID_CRITERIA, findGridEntry, type GridCriterionDef } from '../grid.js';
import type { AuditFacts, Finding } from '../types.js';

import { makeFinding, type RuleDefinition } from './types.js';

/**
 * Rules generated from the closed-grid rubric (see ../grid.ts).
 *
 * Each criterion fires a single QUALITATIVE finding when, and only when,
 * the vision LLM rated it `probleme` (droit au neutre : `neutre` and `bon`
 * never fire). The finding carries the LLM's mandatory justification as
 * evidence — no free numeric score is ever thresholded, so the LLM stops
 * acting as a judge and the "daté alors que clean" false positive dies.
 *
 * Screenshot viewport and region are required. Apparent modernity is never
 * a usability issue, including when legacy stack markers are present.
 */

function makeGridRule(def: GridCriterionDef): RuleDefinition {
  const rule: RuleDefinition = {
    code: def.ruleCode,
    axis: def.axis,
    defaultSeverity: def.severity,
    defaultEffort: 'important',
    kind: 'qualitative',
    evaluate: ({ facts }) => {
      if (!facts.vision.fetched) return null;
      const entry = findGridEntry(facts.vision.uiGrid, def.key);
      if (entry?.rating !== 'probleme' || def.key === 'impression_modernite') return null;
      if (!entry.viewport || !entry.region?.trim()) return null;
      // Justification obligatoire : a `probleme` with no concrete proof is
      // demoted to silence. "Ne produire que ce qu'on peut prouver" — no
      // finding may ship without the element it points at.
      if (entry.justification.trim().length === 0) return null;

      const evidence: Record<string, unknown> = {
        criterion: def.key,
        justification: entry.justification,
        model: facts.vision.model,
        viewport: entry.viewport,
        region: entry.region,
        scope: 'Capture statique limitée, sans test d’interaction',
      };
      return makeFinding(rule, {
        title: `${def.label} : à retravailler`,
        evidence,
      });
    },
  };
  return rule;
}

export const GRID_RULES: RuleDefinition[] = GRID_CRITERIA.map(makeGridRule);

export function applyGridRules(ctx: { facts: AuditFacts; origin: string }): Finding[] {
  const out: Finding[] = [];
  for (const rule of GRID_RULES) {
    const res = rule.evaluate(ctx);
    if (!res) continue;
    if (Array.isArray(res)) out.push(...res);
    else out.push(res);
  }
  return out;
}
