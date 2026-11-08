import { z } from 'zod';

import { parseStoredAiReadiness } from './ai-readiness.js';
import { AuditAxisSchema } from './axes.js';
import { AuditModulesOverrideSchema, AuditModulesSchema } from './modules.js';
import { SLUG_PATTERN } from './slug.js';

export const AuditFullStatusSchema = z.enum(['queued', 'running', 'completed', 'failed']);
export type AuditFullStatus = z.infer<typeof AuditFullStatusSchema>;

export { ALL_AXES, AuditAxisSchema, type AuditAxis } from './axes.js';

export const AuditSeveritySchema = z.enum(['P0', 'P1', 'P2', 'P3']);
export type AuditSeverity = z.infer<typeof AuditSeveritySchema>;

export const AuditEffortSchema = z.enum(['quick_win', 'standard', 'important']);
export type AuditEffort = z.infer<typeof AuditEffortSchema>;

export const AuditBandSchema = z.enum(['excellent', 'good', 'fair', 'poor', 'critical']);
export type AuditBand = z.infer<typeof AuditBandSchema>;

export const AuditAxisScoreSchema = z.object({
  score: z.number(),
  band: AuditBandSchema,
  weight: z.number().optional(),
});
export type AuditAxisScore = z.infer<typeof AuditAxisScoreSchema>;

export const AuditTop3PrioritySchema = z.object({
  title: z.string(),
  reason: z.string(),
  findingIds: z.array(z.string()).optional(),
  expectedOutcome: z.string().optional(),
  findingId: z.string().optional(),
});
export type AuditTop3Priority = z.infer<typeof AuditTop3PrioritySchema>;

export const AuditLegalRefSchema = z.object({
  standard: z.enum(['RGAA', 'WCAG', 'RGPD', 'LCEN', 'EAA', 'CNIL', 'GOOGLE']),
  version: z.string().optional(),
  criterion: z.string().optional(),
  url: z.string().optional(),
  label: z.string(),
});
export type AuditLegalRef = z.infer<typeof AuditLegalRefSchema>;

/**
 * Creation of a full audit (POST /api/audits/full, dashboard only, behind
 * SCANNER_INTERNAL_TOKEN). `modules` overrides the install defaults
 * (axes and costly collectors). `source` says which surface created it.
 * `email` is an optional contact attached to the audit; no email is ever
 * sent by the tool.
 */
export const AuditFullCreateRequestSchema = z.object({
  url: z
    .string()
    .url()
    .max(2048)
    .refine(
      (u) => {
        try {
          const parsed = new URL(u);
          return parsed.protocol === 'http:' || parsed.protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'URL must use http or https protocol' },
    ),
  email: z.string().email().max(254).optional(),
  /** Free label / client reference shown in the dashboard. */
  label: z.string().trim().min(1).max(120).optional(),
  modules: AuditModulesOverrideSchema.optional(),
  source: z.enum(['dashboard', 'api', 'mcp']).optional(),
});
export type AuditFullCreateRequest = z.infer<typeof AuditFullCreateRequestSchema>;

/**
 * Time-to-fix chiffrage over deterministic findings.
 * Mirrors the scanner's CostEstimate. Kept loose (the scanner is the source
 * of truth) so a shape tweak never breaks the report read.
 */
export const CostEstimateSchema = z.object({
  totalMinutes: z.number(),
  totalDays: z.number(),
  dailyRateEur: z.number(),
  billableHoursPerDay: z.number(),
  amountEurLow: z.number(),
  amountEurHigh: z.number(),
  items: z
    .array(
      z.object({
        findingId: z.string(),
        ruleCode: z.string(),
        title: z.string(),
        occurrences: z.number(),
        minutes: z.number(),
      }),
    )
    .default([]),
  uncostedFindingIds: z.array(z.string()).default([]),
  qualitativeExcludedCount: z.number().default(0),
  disclaimer: z.string(),
});
export type CostEstimateResult = z.infer<typeof CostEstimateSchema>;

/** Correction-vs-redesign arbitrage + closed-CMS routing. */
export const RemediationVerdictSchema = z.object({
  mode: z.enum(['correction_or_redesign', 'redesign_only']),
  closedCms: z.boolean(),
  detectedStack: z.string(),
  datedTech: z.boolean(),
  redesignReasons: z.array(z.string()).default([]),
  showQuickFixButton: z.boolean(),
});
export type RemediationVerdictResult = z.infer<typeof RemediationVerdictSchema>;

export const AuditFullResultSchema = z.object({
  slug: z.string().regex(SLUG_PATTERN),
  url: z.string().url(),
  status: AuditFullStatusSchema,
  scanned_at: z.string().nullable(),
  stack: z.string().nullable(),
  stack_confidence: z.number().nullable(),
  sector: z.string().nullable(),
  sector_confidence: z.number().nullable(),
  main_kpi: z.string().nullable(),
  secondary_kpi: z.string().nullable(),
  global_score: z.number().nullable(),
  global_band: AuditBandSchema.nullable(),
  /** Absent axes are not evaluated (disabled or required collector unavailable). */
  axis_scores: z.record(AuditAxisScoreSchema).default({}),
  exec_summary: z.string().nullable(),
  top3_priorities: z.array(AuditTop3PrioritySchema).default([]),
  quick_wins: z.array(z.string()).default([]),
  killer_findings: z.array(z.string()).default([]),
  estimated_impact_narrative: z.string().nullable(),
  llm_provider: z.string().nullable(),
  llm_model: z.string().nullable(),
  llm_duration_ms: z.number().nullable(),
  created_at: z.string(),
  expires_at: z.string(),
  facts: z.record(z.unknown()).optional().nullable(),
  /**
   * URL of the viewport-sized hero screenshot, relative to the web app
   * (`/media/hero/<auditId>.png`, served from MEDIA_DIR). NULL when the
   * capture failed or predates the feature.
   */
  hero_screenshot_url: z
    .string()
    .regex(/^\/media\/[A-Za-z0-9/._-]+$/)
    .nullable()
    .optional(),
  /** Time-to-fix chiffrage. NULL on older audits. */
  cost_estimate: CostEstimateSchema.nullable().optional(),
  /** Correction-vs-redesign verdict. NULL on older audits. */
  remediation: RemediationVerdictSchema.nullable().optional(),
  /** Modules the audit ran with. NULL on audits older than migration 0003 (all enabled). */
  modules: AuditModulesSchema.nullable().optional(),
  /**
   * "Préparation IA" result (module ai_readiness). NULL when the module was
   * off or the audit predates migration 0007. Read leniently: a malformed
   * stored value becomes null rather than breaking the whole report.
   */
  ai_readiness: z.unknown().transform(parseStoredAiReadiness).optional(),
  /** AI readiness score 0-100, null when not evaluated. */
  ai_score: z.number().nullable().optional(),
});
export type AuditFullResult = z.infer<typeof AuditFullResultSchema>;

export const AuditFullFindingSchema = z.object({
  id: z.string(),
  rule_code: z.string(),
  axis: AuditAxisSchema,
  severity: AuditSeveritySchema,
  effort: AuditEffortSchema.nullable(),
  title: z.string(),
  evidence: z.record(z.unknown()).default({}),
  affected_urls: z.array(z.string()).default([]),
  legal_refs: z.array(AuditLegalRefSchema).default([]),
  narrative_constat: z.string().nullable(),
  narrative_impact_business: z.string().nullable(),
  narrative_recommandation: z.string().nullable(),
  narrative_code_snippet: z.string().nullable(),
  created_at: z.string(),
});
export type AuditFullFinding = z.infer<typeof AuditFullFindingSchema>;
