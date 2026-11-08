import { db, pgErrorCode } from '@mynto/db';
import {
  DEFAULT_AUDIT_MODULES,
  parseStoredModules,
  resolveModules,
  type AuditModules,
  type AuditModulesOverride,
} from '@mynto/shared';

import { logger } from '../logger.js';

/**
 * Modules of a new audit: install defaults (Réglages > Modules d'audit) with
 * the per-audit override applied. A DB error falls back to "all enabled"
 * rather than refusing the audit.
 */
export async function modulesForNewAudit(
  override?: AuditModulesOverride | null,
): Promise<AuditModules> {
  let defaults: AuditModules;
  try {
    defaults = await db().auditSettings.getModules();
  } catch (err) {
    logger.warn({ code: pgErrorCode(err) }, 'audit_settings_read_failed_all_enabled');
    defaults = { ...DEFAULT_AUDIT_MODULES };
  }
  return resolveModules(defaults, override);
}

/** Modules of an existing audit, reused by its refresh (same scope as the original). */
export async function modulesOfAudit(auditId: string): Promise<AuditModules | null> {
  try {
    const raw = await db().audits.getModules(auditId);
    return raw === null ? null : parseStoredModules(raw);
  } catch (err) {
    logger.warn({ code: pgErrorCode(err) }, 'audit_modules_read_failed');
    return null;
  }
}
