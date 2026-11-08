import 'server-only';

import { type AuditFullFinding, type AuditFullResult } from '@mynto/shared';

import { db, DbSchemaError, pgErrorCode } from './index';

import { logger } from '@/lib/logger';

/**
 * Public report reads. The repository selects a fixed column allowlist
 * (never email, llm_input or source), filters on expires_at > now() and
 * validates rows with the shared Zod schemas.
 */

export type FullAuditFetchResult =
  | { kind: 'ok'; audit: AuditFullResult }
  | { kind: 'not_found' }
  | { kind: 'error' };

export async function getFullAuditBySlug(slug: string): Promise<FullAuditFetchResult> {
  try {
    const audit = await db().audits.getPublicBySlug(slug);
    if (audit === null) return { kind: 'not_found' };
    return { kind: 'ok', audit };
  } catch (err) {
    if (err instanceof DbSchemaError) {
      logger.error({ issues: err.issues }, 'full_audit_schema_violation');
    } else {
      logger.error({ code: pgErrorCode(err) }, 'full_audit_query_failed');
    }
    return { kind: 'error' };
  }
}

/** Findings of a public report, P0 -> P3. Empty when missing, expired or on error. */
export async function getFullAuditFindingsBySlug(slug: string): Promise<AuditFullFinding[]> {
  try {
    return (await db().audits.listPublicFindingsBySlug(slug)) ?? [];
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'full_audit_findings_query_failed');
    return [];
  }
}
