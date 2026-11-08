import type { AuditModules } from '@mynto/shared';

export interface CollectorPlan {
  lighthouse: boolean;
  axe: boolean;
  vision: boolean;
  hero: boolean;
  designMeasurements: boolean;
}

/**
 * Which costly collectors an audit needs. A collector only runs when its
 * module is on AND at least one axis that consumes it is enabled:
 * Lighthouse feeds performance + accessibility, axe feeds accessibility,
 * the vision LLM feeds UI, UX and conversion.
 */
export function collectorPlan(modules: AuditModules): CollectorPlan {
  const has = (a: AuditModules['axes'][number]): boolean => modules.axes.includes(a);
  return {
    lighthouse: modules.lighthouse && (has('performance') || has('accessibilite')),
    axe: has('accessibilite'),
    vision: modules.vision && (has('ui') || has('ux') || has('conversion')),
    hero: modules.hero,
    designMeasurements: has('ui') || has('ux'),
  };
}
