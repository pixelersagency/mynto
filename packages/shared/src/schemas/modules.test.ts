import { describe, expect, it } from 'vitest';

import {
  AuditModulesOverrideSchema,
  DEFAULT_AUDIT_MODULES,
  allModulesEnabled,
  disabledAxes,
  parseStoredModules,
  resolveModules,
} from './modules.js';

describe('audit modules', () => {
  it('merges an override over the defaults, axes in canonical order', () => {
    const m = resolveModules(DEFAULT_AUDIT_MODULES, { axes: ['ui', 'performance'], vision: false });
    expect(m).toEqual({
      axes: ['performance', 'ui'],
      lighthouse: true,
      vision: false,
      hero: true,
      narrative: true,
      ai_readiness: true,
      site_type: 'auto',
      ai_in_global_score: false,
    });
    expect(disabledAxes(m)).toHaveLength(6);
    expect(allModulesEnabled(m)).toBe(false);
    expect(allModulesEnabled(resolveModules(DEFAULT_AUDIT_MODULES))).toBe(true);
  });

  it('NULL or malformed stored values mean every 8-axis module on, Préparation IA off', () => {
    const legacy = { ...DEFAULT_AUDIT_MODULES, ai_readiness: false };
    expect(parseStoredModules(null)).toEqual(legacy);
    expect(parseStoredModules({ axes: [] })).toEqual(legacy);
    expect(disabledAxes(null)).toEqual([]);
  });

  it('override schema rejects unknown keys and empty axes', () => {
    expect(AuditModulesOverrideSchema.safeParse({ axes: [] }).success).toBe(false);
    expect(AuditModulesOverrideSchema.safeParse({ axes: ['seo'] }).success).toBe(false);
    expect(AuditModulesOverrideSchema.safeParse({ foo: true }).success).toBe(false);
    expect(AuditModulesOverrideSchema.safeParse({ hero: false }).success).toBe(true);
  });

  it('AI readiness: on by default for new installs, overridable per audit except the global score setting', () => {
    expect(DEFAULT_AUDIT_MODULES.ai_readiness).toBe(true);
    expect(DEFAULT_AUDIT_MODULES.ai_in_global_score).toBe(false);
    const install = { ...DEFAULT_AUDIT_MODULES, ai_in_global_score: true };
    const m = resolveModules(install, { ai_readiness: true, site_type: 'ecommerce' });
    expect(m).toMatchObject({
      ai_readiness: true,
      site_type: 'ecommerce',
      ai_in_global_score: true,
    });
    // The install setting cannot be overridden per audit.
    expect(AuditModulesOverrideSchema.safeParse({ ai_in_global_score: true }).success).toBe(false);
    expect(AuditModulesOverrideSchema.safeParse({ site_type: 'boutique' }).success).toBe(false);
    // Allowing the AI module does not change "all modules enabled".
    expect(allModulesEnabled({ ...DEFAULT_AUDIT_MODULES, ai_readiness: true })).toBe(true);
  });

  it('stored values written before phase 4b+ read the new keys as their defaults', () => {
    const legacy = {
      axes: ['seo_technique'],
      lighthouse: true,
      vision: false,
      hero: true,
      narrative: false,
    };
    expect(parseStoredModules(legacy)).toEqual({
      ...legacy,
      ai_readiness: false,
      site_type: 'auto',
      ai_in_global_score: false,
    });
  });
});
