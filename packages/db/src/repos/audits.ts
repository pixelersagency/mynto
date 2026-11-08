import {
  type AuditModules,
  AuditFullFindingSchema,
  AuditFullResultSchema,
  type AuditFullFinding,
  type AuditFullResult,
} from '@mynto/shared';

import { jsonb, type Queryable, type Sql } from '../client.js';
import { mediaUrl } from '../media.js';
import {
  PUBLIC_AUDIT_COLUMNS,
  PUBLIC_AUDIT_SUMMARY_COLUMNS,
  PUBLIC_FINDING_COLUMNS,
} from '../public-columns.js';

import { emitAuditFinished } from './webhooks.js';

export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed';
export type AuditSource = 'web' | 'radar' | 'dashboard' | 'api' | 'mcp';
export type LlmStatus = 'deferred' | 'pending' | 'done' | 'failed';

/** Thrown when a row read from the DB does not match its Zod schema. */
export class DbSchemaError extends Error {
  readonly issues: string[];
  constructor(what: string, issues: string[]) {
    super(`${what}: schema violation`);
    this.name = 'DbSchemaError';
    this.issues = issues;
  }
}

export interface CreateAuditInput {
  slug: string;
  url: string;
  email?: string | null;
  status?: AuditStatus;
  source?: AuditSource;
  llmStatus?: LlmStatus | null;
  /** Free label typed in the dashboard (1-120 chars). */
  label?: string | null;
  /** ISO timestamp. Defaults to the column default (now() + 60 days). */
  expiresAt?: string;
  /** Resolved modules (axes + collectors). NULL = all enabled. */
  modules?: AuditModules | null;
}

/** Writable columns of audits_full (jsonb ones are serialised by the repo). */
export interface AuditPatch {
  status?: AuditStatus;
  scanned_at?: string | null;
  hero_screenshot_key?: string | null;
  stack?: string | null;
  stack_confidence?: number | null;
  sector?: string | null;
  sector_confidence?: number | null;
  main_kpi?: string | null;
  secondary_kpi?: string | null;
  global_score?: number | null;
  global_band?: string | null;
  axis_scores?: unknown;
  exec_summary?: string | null;
  top3_priorities?: unknown;
  quick_wins?: unknown;
  killer_findings?: unknown;
  estimated_impact_narrative?: string | null;
  cost_estimate?: unknown;
  remediation?: unknown;
  facts?: unknown;
  llm_provider?: string | null;
  llm_model?: string | null;
  llm_tokens_in?: number | null;
  llm_tokens_out?: number | null;
  llm_duration_ms?: number | null;
  llm_error?: string | null;
  llm_input?: unknown;
  llm_status?: LlmStatus | null;
  interpreted_at?: string | null;
  /** Préparation IA result (AiReadinessResult), migration 0007. */
  ai_readiness?: unknown;
  ai_score?: number | null;
  /** Favicon media key (favicon/<id>.<ext>), migration 0008. */
  favicon_key?: string | null;
  /** Live step of a running audit, migration 0008. */
  progress_step?: 'loading' | 'analysis' | 'writing' | null;
}

const JSONB_COLUMNS = new Set<string>([
  'axis_scores',
  'top3_priorities',
  'quick_wins',
  'killer_findings',
  'cost_estimate',
  'remediation',
  'facts',
  'llm_input',
  'modules',
  'ai_readiness',
  // audit_findings_full
  'evidence',
  'affected_urls',
  'legal_refs',
]);

type DbValue = string | number | boolean | null | ReturnType<Queryable['json']>;

/**
 * Turns a plain patch into column -> parameter, wrapping jsonb columns.
 * Keys whose value is `undefined` are dropped (not touched), like the
 * PostgREST client did.
 */
export function toDbRow(sql: Queryable, patch: object): Record<string, DbValue> {
  const out: Record<string, DbValue> = {};
  for (const [key, value] of Object.entries(patch) as [string, unknown][]) {
    if (value === undefined) continue;
    if (JSONB_COLUMNS.has(key)) {
      out[key] = jsonb(sql, value);
    } else {
      out[key] = value as DbValue;
    }
  }
  return out;
}

export interface FindingRowInput {
  id: string;
  audit_id: string;
  rule_code: string;
  axis: string;
  severity: string;
  effort: string | null;
  title: string;
  evidence: unknown;
  affected_urls: unknown;
  legal_refs: unknown;
  narrative_constat: string | null;
  narrative_impact_business: string | null;
  narrative_recommandation: string | null;
  narrative_code_snippet: string | null;
}

const FINDING_WRITE_COLUMNS = [
  'id',
  'audit_id',
  'rule_code',
  'axis',
  'severity',
  'effort',
  'title',
  'evidence',
  'affected_urls',
  'legal_refs',
  'narrative_constat',
  'narrative_impact_business',
  'narrative_recommandation',
  'narrative_code_snippet',
] as const;

const UPSERT_CHUNK = 500;

export interface AuditStateRow {
  status: string;
  llm_status: string | null;
  source: string;
}

export interface AuditInterpretRow {
  status: string;
  llm_status: string | null;
  facts: unknown;
  axis_scores: unknown;
  llm_input: unknown;
}

export interface PurgedAudit {
  id: string;
  hero_screenshot_key: string | null;
  favicon_key: string | null;
}

function parsePublicAudit(row: Record<string, unknown>): AuditFullResult {
  const { hero_screenshot_key: key, ...rest } = row;
  const candidate =
    'hero_screenshot_key' in row
      ? { ...rest, hero_screenshot_url: typeof key === 'string' ? mediaUrl(key) : null }
      : rest;
  const parsed = AuditFullResultSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new DbSchemaError(
      'audits_full',
      parsed.error.issues.map((i) => `${i.path.join('.')}:${i.message}`),
    );
  }
  return parsed.data;
}

export function createAuditsRepo(sql: Sql) {
  return {
    /** Inserts a new audit, returns its id. */
    async create(input: CreateAuditInput, db: Queryable = sql): Promise<string> {
      const row = toDbRow(db, {
        slug: input.slug,
        url: input.url,
        email: input.email ?? null,
        status: input.status ?? 'queued',
        source: input.source ?? 'web',
        llm_status: input.llmStatus ?? null,
        label: input.label ?? null,
        expires_at: input.expiresAt,
        modules: input.modules ?? undefined,
      });
      const [inserted] = await db<{ id: string }[]>`
        insert into audits_full ${db(row)} returning id
      `;
      if (inserted === undefined) throw new Error('audits_full insert returned no row');
      return inserted.id;
    },

    async delete(id: string, db: Queryable = sql): Promise<void> {
      await db`delete from audits_full where id = ${id}`;
    },

    /** Unconditional update. Returns the number of rows touched. */
    async update(id: string, patch: AuditPatch, db: Queryable = sql): Promise<number> {
      const row = toDbRow(db, patch);
      if (Object.keys(row).length === 0) return 0;
      const res = await db`update audits_full set ${db(row)} where id = ${id}`;
      return res.count;
    },

    /**
     * Final state of a scan (completed or failed) and its webhook event
     * (audit.completed, audit.refreshed or audit.failed) in one transaction.
     * Returns the number of rows touched.
     */
    async finish(
      id: string,
      patch: Omit<AuditPatch, 'status'> & { status: 'completed' | 'failed' },
    ): Promise<number> {
      return sql.begin(async (tx) => {
        const row = toDbRow(tx, patch);
        const res = await tx`update audits_full set ${tx(row)} where id = ${id}`;
        if (res.count > 0) await emitAuditFinished(tx, id, patch.status);
        return res.count;
      });
    },

    /** Update applied only while llm_status = `expected`. Returns rows touched. */
    async updateIfLlmStatus(
      id: string,
      expected: LlmStatus,
      patch: AuditPatch,
      db: Queryable = sql,
    ): Promise<number> {
      const row = toDbRow(db, patch);
      if (Object.keys(row).length === 0) return 0;
      const res = await db`
        update audits_full set ${db(row)} where id = ${id} and llm_status = ${expected}
      `;
      return res.count;
    },

    /** Stored modules of an audit (raw jsonb, parse with parseStoredModules). */
    async getModules(id: string): Promise<unknown> {
      const [row] = await sql<{ modules: unknown }[]>`
        select modules from audits_full where id = ${id}
      `;
      return row?.modules ?? null;
    },

    /** Stored Préparation IA result of an audit (raw jsonb, parse with parseStoredAiReadiness). */
    async getAiReadiness(id: string): Promise<unknown> {
      const [row] = await sql<{ ai_readiness: unknown }[]>`
        select ai_readiness from audits_full where id = ${id}
      `;
      return row?.ai_readiness ?? null;
    },

    /** Public findings of an audit by id (admin and API reads), P0 first. */
    async listFindingsByAuditId(auditId: string): Promise<AuditFullFinding[]> {
      const rows = await sql<Record<string, unknown>[]>`
        select ${sql(PUBLIC_FINDING_COLUMNS as unknown as string[])}
          from audit_findings_full
         where audit_id = ${auditId}
         order by severity asc, id asc
      `;
      const out: AuditFullFinding[] = [];
      for (const row of rows) {
        const parsed = AuditFullFindingSchema.safeParse(row);
        if (parsed.success) out.push(parsed.data);
      }
      return out;
    },

    async getState(id: string): Promise<AuditStateRow | null> {
      const [row] = await sql<AuditStateRow[]>`
        select status, llm_status, source from audits_full where id = ${id}
      `;
      return row ?? null;
    },

    /**
     * Atomic claim of the deferred interpretation: deferred|failed -> pending.
     * Returns the new state, or null when another caller already claimed it
     * (or the row is in another state).
     */
    async claimInterpretation(id: string): Promise<AuditStateRow | null> {
      const [row] = await sql<AuditStateRow[]>`
        update audits_full
           set llm_status = 'pending', llm_error = null
         where id = ${id} and llm_status in ('deferred', 'failed')
        returning status, llm_status, source
      `;
      return row ?? null;
    },

    async getForInterpret(id: string): Promise<AuditInterpretRow | null> {
      const [row] = await sql<AuditInterpretRow[]>`
        select status, llm_status, facts, axis_scores, llm_input from audits_full where id = ${id}
      `;
      return row ?? null;
    },

    /** Finding rows (no narrative) used to rebuild the LLM input. */
    async listFindingsForRebuild(auditId: string): Promise<Record<string, unknown>[]> {
      return sql<Record<string, unknown>[]>`
        select id, rule_code, axis, severity, effort, title, evidence, affected_urls, legal_refs
          from audit_findings_full
         where audit_id = ${auditId}
      `;
    },

    /** Multi-row upsert keyed on finding id (all columns overwritten). */
    async upsertFindings(rows: FindingRowInput[], db: Queryable = sql): Promise<void> {
      for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
        const chunk = rows.slice(i, i + UPSERT_CHUNK).map((r) => toDbRow(db, r));
        await db`
          insert into audit_findings_full ${db(chunk, ...FINDING_WRITE_COLUMNS)}
          on conflict (id) do update set
            audit_id = excluded.audit_id,
            rule_code = excluded.rule_code,
            axis = excluded.axis,
            severity = excluded.severity,
            effort = excluded.effort,
            title = excluded.title,
            evidence = excluded.evidence,
            affected_urls = excluded.affected_urls,
            legal_refs = excluded.legal_refs,
            narrative_constat = excluded.narrative_constat,
            narrative_impact_business = excluded.narrative_impact_business,
            narrative_recommandation = excluded.narrative_recommandation,
            narrative_code_snippet = excluded.narrative_code_snippet
        `;
      }
    },

    // ----------------------------------------------------------------
    // Public reads: fixed column lists, non-expired audits only.
    // ----------------------------------------------------------------

    /**
     * Public report by slug. `variant: 'summary'` is the scanner API shape
     * (no facts, hero, chiffrage, remediation). Null when missing or expired.
     * Throws DbSchemaError when the stored row does not match the schema.
     */
    async getPublicBySlug(
      slug: string,
      variant: 'full' | 'summary' = 'full',
    ): Promise<AuditFullResult | null> {
      const cols = variant === 'full' ? PUBLIC_AUDIT_COLUMNS : PUBLIC_AUDIT_SUMMARY_COLUMNS;
      const [row] = await sql<Record<string, unknown>[]>`
        select ${sql(cols as unknown as string[])}
          from audits_full
         where slug = ${slug} and expires_at > now()
      `;
      return row === undefined ? null : parsePublicAudit(row);
    },

    /** Public status of a report (PDF export gate). */
    async getPublicStatusBySlug(slug: string): Promise<{ slug: string; status: string } | null> {
      const [row] = await sql<{ slug: string; status: string }[]>`
        select slug, status from audits_full where slug = ${slug} and expires_at > now()
      `;
      return row ?? null;
    },

    /**
     * Public findings of a non-expired report, severity P0 -> P3. Null when
     * the audit is missing or expired. Rows failing the schema are skipped.
     */
    async listPublicFindingsBySlug(slug: string): Promise<AuditFullFinding[] | null> {
      const [audit] = await sql<{ id: string }[]>`
        select id from audits_full where slug = ${slug} and expires_at > now()
      `;
      if (audit === undefined) return null;
      const rows = await sql<Record<string, unknown>[]>`
        select ${sql(PUBLIC_FINDING_COLUMNS as unknown as string[])}
          from audit_findings_full
         where audit_id = ${audit.id}
         order by severity asc, id asc
      `;
      const out: AuditFullFinding[] = [];
      for (const row of rows) {
        const parsed = AuditFullFindingSchema.safeParse(row);
        if (parsed.success) out.push(parsed.data);
      }
      return out;
    },

    // ----------------------------------------------------------------
    // Internal lookups by slug (no expiry filter, never exposed as-is).
    // ----------------------------------------------------------------

    async getIdBySlug(slug: string): Promise<string | null> {
      const [row] = await sql<{ id: string }[]>`select id from audits_full where slug = ${slug}`;
      return row?.id ?? null;
    },

    async getSourceBySlug(slug: string): Promise<string | null> {
      const [row] = await sql<{ source: string }[]>`
        select source from audits_full where slug = ${slug}
      `;
      return row?.source ?? null;
    },

    /**
     * Deletes audits expired for more than `graceDays` days (children
     * cascade). Returns the deleted ids + hero keys so the caller can
     * remove the media files.
     */
    async purgeExpired(graceDays = 1): Promise<PurgedAudit[]> {
      return sql<PurgedAudit[]>`
        delete from audits_full
         where expires_at < now() - make_interval(days => ${graceDays})
        returning id, hero_screenshot_key, favicon_key
      `;
    },
  };
}

export type AuditsRepo = ReturnType<typeof createAuditsRepo>;
