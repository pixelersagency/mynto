import { z } from 'zod';

import { AiSiteTypeInputSchema } from './ai-readiness.js';
import { ALL_AXES, AuditAxisSchema, type AuditAxis } from './axes.js';

/**
 * Audit modules: which of the 8 axes run, and which costly collectors are
 * used. Install defaults live in `audit_settings`, a per-audit override can
 * be passed at creation (dashboard, API, MCP) and the resolved set is stored
 * on the audit row (`audits_full.modules`). A NULL stored value means "all
 * enabled" (audits created before migration 0003).
 *
 * Collectors:
 *   - lighthouse: Lighthouse run (performance and accessibility rules);
 *   - vision: screenshot analysis by the vision LLM (UI, UX, conversion);
 *   - hero: hero screenshot shown at the top of the report;
 *   - narrative: LLM rewrite of the report (summary, priorities, findings).
 *
 * Optional modules (phase 4b+):
 *   - ai_readiness: the "Préparation IA" tests (24 deterministic checks), ON
 *     by default for new installs since phase 4c (stored rows without the
 *     key, and audits older than migration 0003, read it as false: the
 *     module did not run for them);
 *   - site_type: site type of those tests (`auto` = detected from the home page);
 *   - ai_in_global_score: install setting, folds the AI readiness score into
 *     the global score. Copied from the defaults at creation, never overridden
 *     per audit, so the scores of one install stay comparable.
 * Stored values written before these keys existed read them as their default.
 */
export const AUDIT_COLLECTORS = ['lighthouse', 'vision', 'hero', 'narrative'] as const;
export type AuditModuleCollector = (typeof AUDIT_COLLECTORS)[number];

const AxesListSchema = z
  .array(AuditAxisSchema)
  .min(1, 'Choisis au moins un axe')
  .max(ALL_AXES.length)
  .transform((axes) => sortAxes(axes));

export const AuditModulesSchema = z
  .object({
    axes: AxesListSchema,
    lighthouse: z.boolean(),
    vision: z.boolean(),
    hero: z.boolean(),
    narrative: z.boolean(),
    ai_readiness: z.boolean().default(false),
    site_type: AiSiteTypeInputSchema.default('auto'),
    ai_in_global_score: z.boolean().default(false),
  })
  .strict();
export type AuditModules = z.infer<typeof AuditModulesSchema>;

/** Partial override accepted by the create endpoints, merged over the defaults. */
export const AuditModulesOverrideSchema = z
  .object({
    axes: AxesListSchema.optional(),
    lighthouse: z.boolean().optional(),
    vision: z.boolean().optional(),
    hero: z.boolean().optional(),
    narrative: z.boolean().optional(),
    ai_readiness: z.boolean().optional(),
    site_type: AiSiteTypeInputSchema.optional(),
  })
  .strict();
export type AuditModulesOverride = z.infer<typeof AuditModulesOverrideSchema>;

export const DEFAULT_AUDIT_MODULES: AuditModules = Object.freeze({
  axes: [...ALL_AXES],
  lighthouse: true,
  vision: true,
  hero: true,
  narrative: true,
  ai_readiness: true,
  site_type: 'auto',
  ai_in_global_score: false,
}) as AuditModules;

/** Modules of audits created before migration 0003 (NULL): every axis, no Préparation IA. */
const LEGACY_AUDIT_MODULES: AuditModules = Object.freeze({
  ...DEFAULT_AUDIT_MODULES,
  ai_readiness: false,
}) as AuditModules;

/** Axes in the canonical order, without duplicates. */
export function sortAxes(axes: readonly AuditAxis[]): AuditAxis[] {
  const set = new Set(axes);
  return ALL_AXES.filter((a) => set.has(a));
}

/** Defaults with the override applied. */
export function resolveModules(
  defaults: AuditModules,
  override?: AuditModulesOverride | null,
): AuditModules {
  return {
    axes: sortAxes(override?.axes ?? defaults.axes),
    lighthouse: override?.lighthouse ?? defaults.lighthouse,
    vision: override?.vision ?? defaults.vision,
    hero: override?.hero ?? defaults.hero,
    narrative: override?.narrative ?? defaults.narrative,
    ai_readiness: override?.ai_readiness ?? defaults.ai_readiness,
    site_type: override?.site_type ?? defaults.site_type,
    ai_in_global_score: defaults.ai_in_global_score,
  };
}

/**
 * Stored value -> modules. NULL, missing or malformed rows (audits created
 * before migration 0003) mean every module enabled.
 */
export function parseStoredModules(value: unknown): AuditModules {
  if (value === null || value === undefined)
    return { ...LEGACY_AUDIT_MODULES, axes: [...ALL_AXES] };
  const parsed = AuditModulesSchema.safeParse(value);
  return parsed.success ? parsed.data : { ...LEGACY_AUDIT_MODULES, axes: [...ALL_AXES] };
}

export function isAxisEnabled(modules: AuditModules | null | undefined, axis: AuditAxis): boolean {
  if (!modules) return true;
  return modules.axes.includes(axis);
}

/** Axes not evaluated by this audit, in canonical order. */
export function disabledAxes(modules: AuditModules | null | undefined): AuditAxis[] {
  if (!modules) return [];
  return ALL_AXES.filter((a) => !modules.axes.includes(a));
}

/**
 * True when every axis and collector is on. The Préparation IA module is not
 * part of it.
 */
export function allModulesEnabled(modules: AuditModules): boolean {
  return (
    modules.axes.length === ALL_AXES.length &&
    modules.lighthouse &&
    modules.vision &&
    modules.hero &&
    modules.narrative
  );
}
