import { AuditModulesSchema, type AuditModules, type AuditModulesOverride } from '@mynto/shared';

/**
 * Modules fieldset of the dashboard forms (defaults in Réglages, override
 * in Nouvel audit): `axes` checkboxes, one checkbox per collector, the
 * Préparation IA checkbox and its site type, and (Réglages only) the
 * "include in the global score" install setting.
 */
export function modulesFromForm(
  form: FormData,
): { ok: true; modules: AuditModules } | { ok: false; error: string } {
  const siteType = form.get('site_type');
  const parsed = AuditModulesSchema.safeParse({
    axes: form.getAll('axes').filter((v): v is string => typeof v === 'string'),
    lighthouse: form.get('lighthouse') === 'on',
    vision: form.get('vision') === 'on',
    hero: form.get('hero') === 'on',
    narrative: form.get('narrative') === 'on',
    ai_readiness: form.get('ai_readiness') === 'on',
    site_type: typeof siteType === 'string' && siteType.length > 0 ? siteType : 'auto',
    ai_in_global_score: form.get('ai_in_global_score') === 'on',
  });
  if (!parsed.success) {
    const axesIssue = parsed.error.issues.find((i) => i.path[0] === 'axes');
    return { ok: false, error: axesIssue ? 'Choisis au moins un axe.' : 'Sélection invalide.' };
  }
  return { ok: true, modules: parsed.data };
}

/**
 * Per-audit override from the "Nouvel audit" form. `ai_in_global_score` is
 * an install setting (Réglages) and is never sent per audit.
 */
export function overrideFromModules(m: AuditModules): AuditModulesOverride {
  return {
    axes: m.axes,
    lighthouse: m.lighthouse,
    vision: m.vision,
    hero: m.hero,
    narrative: m.narrative,
    ai_readiness: m.ai_readiness,
    site_type: m.site_type,
  };
}
