import type { AuditAxis, AuditFacts, Finding } from '../types.js';

import { applyAccessibiliteRules } from './accessibilite.js';
import { applyConformiteRules } from './conformite.js';
import { applyConversionRules } from './conversion.js';
import { applyGridRules } from './grid-rules.js';
import { applyPerformanceRules } from './performance.js';
import { applySeoContenuRules } from './seo-contenu.js';
import { applySeoTechniqueRules } from './seo-technique.js';
import { applyUiRules } from './ui.js';
import { applyUxRules } from './ux.js';

/**
 * Runs the rules of the enabled axes (all of them by default). Rule groups
 * of a disabled axis are skipped; the cross-axis grid rules run when one of
 * their axes is enabled and their findings are filtered by axis.
 */
export function applyAllRules(facts: AuditFacts, enabledAxes?: readonly AuditAxis[]): Finding[] {
  const on = (axis: AuditAxis): boolean => enabledAxes === undefined || enabledAxes.includes(axis);
  const origin = (() => {
    try {
      return new URL(facts.http.finalUrl).origin;
    } catch {
      try {
        return new URL(facts.url).origin;
      } catch {
        return facts.url;
      }
    }
  })();

  const ctx = { facts, origin };
  const findings = [
    ...(on('seo_technique') ? applySeoTechniqueRules(ctx) : []),
    ...(on('seo_contenu') ? applySeoContenuRules(ctx) : []),
    ...(on('accessibilite') ? applyAccessibiliteRules(ctx) : []),
    ...(on('conformite') ? applyConformiteRules(ctx) : []),
    ...(on('conversion') ? applyConversionRules(ctx) : []),
    ...(on('performance') ? applyPerformanceRules(ctx) : []),
    ...(on('ui') ? applyUiRules(ctx) : []),
    ...(on('ux') ? applyUxRules(ctx) : []),
    ...(on('ui') || on('ux') ? applyGridRules(ctx) : []),
  ];
  return enabledAxes === undefined ? findings : findings.filter((f) => on(f.axis));
}
