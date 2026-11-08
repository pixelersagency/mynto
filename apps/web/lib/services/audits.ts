import 'server-only';

import type { DashboardAuditRow } from '@mynto/db';
import {
  AI_CHECK_LABEL,
  AI_READINESS_AXIS,
  AiSiteTypeSchema,
  ALL_AXES,
  aiRuleCode,
  parseStoredAiReadiness,
  parseStoredModules,
  type AiCheckResult,
  type AiReadinessResult,
  type ApiAiCheck,
  type ApiAiReadiness,
  type ApiAnalyticsSummary,
  type ApiAudit,
  type ApiAuditList,
  type ApiAuditStatus,
  type ApiCreateAuditBody,
  type ApiFinding,
  type ApiListAuditsQuery,
} from '@mynto/shared';

import { db, pgErrorCode } from '../db';
import { publicUrl } from '../env';
import { logger } from '../logger';
import { ScannerNotConfiguredError, callScannerInternal } from '../scanner/client';

/**
 * Service layer of the audits, shared by the dashboard server actions, the
 * REST API v1 and the MCP server (HTTP and, through the REST API, stdio).
 * One place decides what is exposed: never the contact email, the LLM
 * inputs or any secret.
 *
 * Writes go through the scanner (URL safety check, slug, queue); reads go
 * straight to Postgres.
 */

export type AuditSourceOfCall = 'dashboard' | 'api' | 'mcp';

export class ServiceError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.status = status;
  }
}

const SCANNER_ERRORS: Record<string, { status: number; message: string }> = {
  unsafe_url: {
    status: 400,
    message: 'Cette adresse pointe vers un réseau privé ou n’est pas joignable.',
  },
  invalid_url: { status: 400, message: 'Cette adresse ne ressemble pas à un site web.' },
  invalid_request: { status: 400, message: 'Requête invalide.' },
  queue_unavailable: {
    status: 503,
    message: 'La file d’audit ne répond pas. Réessaye dans un instant.',
  },
  internal_auth_not_configured: {
    status: 503,
    message: 'Le scanner n’a pas de SCANNER_INTERNAL_TOKEN. Configure-le des deux côtés.',
  },
  unauthorized: {
    status: 503,
    message: 'Le scanner refuse le jeton interne. Vérifie SCANNER_INTERNAL_TOKEN.',
  },
};

function scannerFailure(body: unknown, status: number): ServiceError {
  const code =
    typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  if (typeof code === 'string' && code in SCANNER_ERRORS) {
    const e = SCANNER_ERRORS[code];
    if (e) return new ServiceError(code, e.status, e.message);
  }
  if (status === 429) {
    return new ServiceError('rate_limited', 429, 'Trop d’audits lancés cette heure-ci.');
  }
  if (status === 404) return new ServiceError('not_found', 404, 'Audit introuvable.');
  return new ServiceError('scanner_error', 502, 'Le scanner n’a pas pu traiter la demande.');
}

async function scanner(
  method: 'POST' | 'DELETE',
  path: string,
  payload?: unknown,
): Promise<{ status: number; body: unknown }> {
  try {
    return await callScannerInternal(method, path, payload);
  } catch (err) {
    if (err instanceof ScannerNotConfiguredError) {
      throw new ServiceError(
        'scanner_not_configured',
        503,
        'SCANNER_INTERNAL_TOKEN manque côté web. Ajoute-le puis redémarre.',
      );
    }
    logger.error({ err: (err as Error).name }, 'scanner_call_failed');
    throw new ServiceError('scanner_unreachable', 503, 'Le scanner ne répond pas.');
  }
}

function dbFailure(err: unknown, what: string): ServiceError {
  logger.error({ code: pgErrorCode(err) }, what);
  return new ServiceError('database_error', 503, 'Base de données indisponible.');
}

// -------------------------------------------------------------------------
// Mapping
// -------------------------------------------------------------------------

function apiStatus(status: string, expiresAt: string, now: number): ApiAuditStatus {
  if (Date.parse(expiresAt) <= now) return 'expired';
  if (status === 'completed' || status === 'failed' || status === 'running') return status;
  return 'queued';
}

function to100(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.max(0, Math.min(100, Math.round(v * 10)))
    : null;
}

/** Préparation IA summary of a dashboard row (no per-test detail). Pure. */
export function toApiAiReadiness(row: DashboardAuditRow): ApiAiReadiness {
  const modules = parseStoredModules(row.modules);
  const ran = row.ai_status === 'completed' || row.ai_status === 'failed';
  const finished = row.status === 'completed';
  const siteType = AiSiteTypeSchema.safeParse(row.ai_site_type);
  return {
    evaluated: modules.ai_readiness || ran,
    score: finished && row.ai_status === 'completed' ? row.ai_score : null,
    level: finished && row.ai_status === 'completed' ? row.ai_level : null,
    level_name: null,
    site_type: ran && siteType.success ? siteType.data : null,
    site_type_auto: ran ? row.ai_site_type_auto : null,
    included_in_global_score: row.ai_included_in_global_score === true,
  };
}

/** Per-test results of a stored Préparation IA run. Pure (tested). */
export function toApiAiChecks(result: AiReadinessResult): ApiAiCheck[] {
  return result.checks.map((c: AiCheckResult) => ({
    id: c.id,
    rule_code: aiRuleCode(c.id),
    label: AI_CHECK_LABEL[c.id],
    category: c.category,
    status: c.status,
    applicable: c.applicable !== false,
    message: c.message,
    fix: c.fixPrompt ?? null,
  }));
}

const AI_SEVERITY_BY_WEIGHT: Record<number, ApiFinding['severity']> = { 3: 'P1', 2: 'P2' };

/**
 * Failed Préparation IA tests as findings (axis `ia`, rule_code `ia.<test>`),
 * so API and MCP clients read every problem from one list. Weight 3 -> P1,
 * 2 -> P2, otherwise P3. Pure (tested).
 */
export function aiFindings(auditId: string, result: AiReadinessResult): ApiFinding[] {
  return result.checks
    .filter((c) => c.status === 'fail' && c.applicable !== false)
    .map((c) => ({
      id: `${aiRuleCode(c.id)}:${auditId.slice(0, 8)}`,
      rule_code: aiRuleCode(c.id),
      axis: AI_READINESS_AXIS,
      severity: AI_SEVERITY_BY_WEIGHT[c.weight] ?? 'P3',
      effort: null,
      title: `${AI_CHECK_LABEL[c.id]} : ${c.message}`,
      affected_urls: [],
      recommendation: c.fixPrompt ?? null,
    }));
}

/** Dashboard row -> public API shape. Pure (tested). */
export function toApiAudit(row: DashboardAuditRow, base: string, now = Date.now()): ApiAudit {
  const root = base.replace(/\/+$/, '');
  const modules = parseStoredModules(row.modules);
  const status = apiStatus(row.status, row.expires_at, now);
  const scores =
    typeof row.axis_scores === 'object' && row.axis_scores !== null
      ? (row.axis_scores as Record<string, { score?: unknown; band?: unknown } | undefined>)
      : {};
  const finished = row.status === 'completed';
  const tracking = row.tracking_token ? `${root}/r/${row.tracking_token}` : null;
  return {
    id: row.id,
    url: row.url,
    label: row.label,
    status,
    source: row.source,
    score: finished ? to100(row.global_score) : null,
    band: finished ? row.global_band : null,
    axes: ALL_AXES.map((axis) => {
      const enabled = modules.axes.includes(axis);
      const s = enabled && finished ? scores[axis] : undefined;
      const evaluated =
        enabled && (!finished || (typeof s?.score === 'number' && Number.isFinite(s.score)));
      return {
        axis,
        evaluated,
        score: s ? to100(s.score) : null,
        band: s && typeof s.band === 'string' ? s.band : null,
      };
    }),
    modules,
    ai_readiness: toApiAiReadiness(row),
    created_at: row.created_at,
    scanned_at: row.scanned_at,
    expires_at: row.expires_at,
    // Radar reports are only served behind their tracking link.
    report_url:
      row.source === 'radar' && tracking !== null ? tracking : `${root}/audit/full/${row.slug}`,
    tracking_url: tracking,
    template: row.template_id,
    views_count: row.views_count,
    last_viewed_at: row.last_viewed_at,
    pages: row.pages,
  };
}

// -------------------------------------------------------------------------
// Reads
// -------------------------------------------------------------------------

export async function listAudits(q: ApiListAuditsQuery): Promise<ApiAuditList> {
  try {
    const res = await db().dashboard.listAudits({
      status: q.status ?? null,
      q: q.q ?? null,
      limit: q.limit,
      offset: q.offset,
    });
    const base = publicUrl();
    return {
      data: res.rows.map((r) => toApiAudit(r, base)),
      pagination: { limit: q.limit, offset: q.offset, total: res.total },
    };
  } catch (err) {
    throw dbFailure(err, 'service_list_audits_failed');
  }
}

/** Current audit for this id (an id replaced by a refresh resolves to the new scan). */
export async function getAudit(id: string): Promise<ApiAudit> {
  let row: DashboardAuditRow | undefined;
  try {
    const current = await db().dashboard.currentId(id);
    if (current !== null) {
      const res = await db().dashboard.listAudits({ ids: [current], limit: 1 });
      row = res.rows[0];
    }
  } catch (err) {
    throw dbFailure(err, 'service_get_audit_failed');
  }
  if (row === undefined) throw new ServiceError('not_found', 404, 'Audit introuvable.');
  const audit = toApiAudit(row, publicUrl());
  // Per-test detail of the Préparation IA, single audit reads only.
  const ai = await storedAiReadiness(audit.id);
  if (ai !== null) {
    audit.ai_readiness = {
      ...audit.ai_readiness,
      level_name: audit.ai_readiness.score === null ? null : ai.level_name,
      checks: toApiAiChecks(ai),
    };
  }
  return audit;
}

async function storedAiReadiness(id: string): Promise<AiReadinessResult | null> {
  try {
    return parseStoredAiReadiness(await db().audits.getAiReadiness(id));
  } catch (err) {
    throw dbFailure(err, 'service_ai_readiness_failed');
  }
}

export async function getFindings(id: string): Promise<ApiFinding[]> {
  const audit = await getAudit(id);
  try {
    const rows = await db().audits.listFindingsByAuditId(audit.id);
    const ai = await storedAiReadiness(audit.id);
    const axisFindings: ApiFinding[] = rows.map((f) => ({
      id: f.id,
      rule_code: f.rule_code,
      axis: f.axis,
      severity: f.severity,
      effort: f.effort,
      title: f.title,
      affected_urls: f.affected_urls,
      recommendation: f.narrative_recommandation,
    }));
    if (ai === null || audit.status !== 'completed') return axisFindings;
    // Same order as the axis findings: most severe first.
    return [...axisFindings, ...aiFindings(audit.id, ai)].sort((a, b) =>
      a.severity === b.severity ? 0 : a.severity < b.severity ? -1 : 1,
    );
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw dbFailure(err, 'service_findings_failed');
  }
}

export async function analyticsSummary(
  days: number,
  now = new Date(),
): Promise<ApiAnalyticsSummary> {
  const to = now.toISOString();
  const from = new Date(now.getTime() - days * 86_400_000).toISOString();
  try {
    return await db().analytics.summary({ from, to });
  } catch (err) {
    throw dbFailure(err, 'service_analytics_failed');
  }
}

// -------------------------------------------------------------------------
// Writes (through the scanner)
// -------------------------------------------------------------------------

/** `site_type` is a shortcut for `modules.site_type` (the explicit one wins). */
function modulesOverride(input: ApiCreateAuditBody): ApiCreateAuditBody['modules'] {
  if (input.site_type === undefined) return input.modules;
  return { site_type: input.site_type, ...(input.modules ?? {}) };
}

export async function createAudit(
  input: ApiCreateAuditBody,
  source: AuditSourceOfCall,
): Promise<ApiAudit> {
  const res = await scanner('POST', '/api/audits/full', {
    url: input.url,
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(modulesOverride(input) !== undefined ? { modules: modulesOverride(input) } : {}),
    source,
  });
  if (res.status !== 202) {
    logger.warn({ status: res.status, source }, 'service_create_audit_refused');
    throw scannerFailure(res.body, res.status);
  }
  const id = (res.body as { id?: unknown }).id;
  if (typeof id !== 'string') throw new ServiceError('scanner_error', 502, 'Réponse inattendue.');
  if (input.template !== undefined) {
    // Unknown or disabled templates fall back to the default at render time.
    await db()
      .reports.setAuditTemplate(id, input.template)
      .catch((err: unknown) => {
        logger.warn({ code: pgErrorCode(err) }, 'service_audit_template_failed');
      });
  }
  logger.info({ source }, 'service_audit_created');
  return getAudit(id);
}

export interface RefreshOutcome {
  audit: ApiAudit;
  refreshed: boolean;
  reason?: string;
}

export async function refreshAudit(id: string): Promise<RefreshOutcome> {
  const current = await getAudit(id);
  const res = await scanner('POST', `/api/audits/full/${current.id}/refresh`);
  if (res.status === 202) {
    const newId = (res.body as { id?: unknown }).id;
    return {
      audit: await getAudit(typeof newId === 'string' ? newId : current.id),
      refreshed: true,
    };
  }
  if (res.status === 200 || res.status === 409) {
    const reason = (res.body as { reason?: unknown; error?: unknown }).reason;
    return {
      audit: await getAudit(current.id),
      refreshed: false,
      reason: typeof reason === 'string' ? reason : 'in_progress',
    };
  }
  throw scannerFailure(res.body, res.status);
}

/** Deletes an audit (and the scans it replaced). Returns the number of rows removed. */
export async function deleteAudit(id: string): Promise<number> {
  const current = await getAudit(id);
  const res = await scanner('DELETE', `/api/audits/full/${current.id}`);
  if (res.status === 200) {
    const n = (res.body as { deleted?: unknown }).deleted;
    return typeof n === 'number' ? n : 1;
  }
  throw scannerFailure(res.body, res.status);
}
