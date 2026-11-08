import { z } from 'zod';

import {
  AiSiteTypeInputSchema,
  type AiCheckCategory,
  type AiCheckId,
  type AiCheckStatus,
  type AiSiteType,
} from './ai-readiness.js';
import { type AuditAxis } from './axes.js';
import { AuditModulesOverrideSchema, type AuditModules } from './modules.js';

/**
 * Public REST API v1 (/api/v1, Bearer API key) and MCP tools: request
 * schemas and response shapes. Shared by the web app (server), the MCP
 * tool definitions and the stdio MCP client, so the three never drift.
 *
 * Responses never carry the contact email, the LLM inputs or any secret.
 */

const httpUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
  .refine((v) => {
    try {
      const u = new URL(v);
      return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
    } catch {
      return false;
    }
  }, 'URL http(s) attendue');

export const ApiCreateAuditBodySchema = z
  .object({
    url: httpUrl.describe('Site to audit (home page). "https://" is added when missing.'),
    label: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe('Free label or client reference, visible only to the agency.'),
    modules: AuditModulesOverrideSchema.optional().describe(
      'Override of the install defaults: axes to evaluate, costly collectors (lighthouse, vision, hero, narrative) and the optional ai_readiness module.',
    ),
    site_type: AiSiteTypeInputSchema.optional().describe(
      'Site type for the AI readiness tests: auto (detected), vitrine, contenu, app_api or ecommerce. Shortcut for modules.site_type.',
    ),
    template: z
      .string()
      .regex(/^[a-z][a-z0-9-]{1,39}$/)
      .optional()
      .describe(
        'Report template id (standard, compact, commercial or one of the agency). Omit for the install default.',
      ),
  })
  .strict();
export type ApiCreateAuditBody = z.infer<typeof ApiCreateAuditBodySchema>;

export const ApiAuditStatusFilterSchema = z.enum(['in_progress', 'completed', 'failed', 'expired']);
export type ApiAuditStatusFilter = z.infer<typeof ApiAuditStatusFilterSchema>;

export const ApiListAuditsQuerySchema = z
  .object({
    status: ApiAuditStatusFilterSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).max(100_000).default(0),
    q: z.string().trim().max(200).optional(),
  })
  .strict();
export type ApiListAuditsQuery = z.infer<typeof ApiListAuditsQuerySchema>;

export const ANALYTICS_PERIODS = [7, 30, 90] as const;
export const ApiAnalyticsQuerySchema = z
  .object({
    days: z.coerce
      .number()
      .int()
      .refine((d) => (ANALYTICS_PERIODS as readonly number[]).includes(d), '7, 30 ou 90')
      .default(30),
  })
  .strict();

export const ApiAuditIdSchema = z.string().uuid();

export type ApiAuditStatus = 'queued' | 'running' | 'completed' | 'failed' | 'expired';

export interface ApiAxisResult {
  axis: AuditAxis;
  /** False when the axis was disabled or its required collector was unavailable ("Non évalué"). */
  evaluated: boolean;
  /** 0-100, null when not evaluated or not finished. */
  score: number | null;
  band: string | null;
}

export interface ApiAiCheck {
  id: AiCheckId;
  /** `ia.<id>`, same code as in the findings. */
  rule_code: string;
  label: string;
  category: AiCheckCategory;
  /** pass, fail, neutral (optional or out of scope) or skipped (probe could not run). */
  status: AiCheckStatus;
  /** False when the standard does not apply to this site type. */
  applicable: boolean;
  message: string;
  /** Fix instruction, failures only. */
  fix: string | null;
}

export interface ApiAiReadiness {
  /** False when the ai_readiness module was off for this audit ("Non évalué"). */
  evaluated: boolean;
  /** 0-100, null when not evaluated, not finished or when the run failed. */
  score: number | null;
  level: number | null;
  level_name: string | null;
  site_type: AiSiteType | null;
  site_type_auto: boolean | null;
  /** True when this score is part of the global score (install setting). */
  included_in_global_score: boolean;
  /** Per-test results. Only on GET /audits/{id} (and get_audit), not in lists. */
  checks?: ApiAiCheck[];
}

export interface ApiAudit {
  id: string;
  url: string;
  label: string | null;
  status: ApiAuditStatus;
  /** dashboard, radar, api, mcp (web for legacy rows). */
  source: string;
  /** 0-100 over the evaluated axes only, null until completed. */
  score: number | null;
  band: string | null;
  axes: ApiAxisResult[];
  modules: AuditModules;
  /** "Préparation IA" (optional module), separate from the 8 axes. */
  ai_readiness: ApiAiReadiness;
  created_at: string;
  scanned_at: string | null;
  expires_at: string;
  /** Direct report URL (does not count as an opening). */
  report_url: string;
  /** Tracking link to send to the prospect, null when the audit has none. */
  tracking_url: string | null;
  /** Report template of the audit (null = install default). */
  template: string | null;
  views_count: number;
  last_viewed_at: string | null;
  /** Pages analysed (home + crawled), completed audits only. */
  pages: number | null;
}

export interface ApiFinding {
  id: string;
  rule_code: string;
  /** One of the 8 axes, or `ia` for a failed AI readiness test (rule_code `ia.<test>`). */
  axis: AuditAxis | 'ia';
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  effort: string | null;
  title: string;
  affected_urls: string[];
  recommendation: string | null;
}

export interface ApiPagination {
  limit: number;
  offset: number;
  total: number;
}

export interface ApiAuditList {
  data: ApiAudit[];
  pagination: ApiPagination;
}

export interface ApiAnalyticsSummary {
  period_days: number;
  from: string;
  to: string;
  audits: { total: number; completed: number; failed: number; in_progress: number };
  /** One entry per ISO week (Monday, Europe/Paris) of the period, oldest first. */
  weekly: { week_start: string; completed: number; failed: number; in_progress: number }[];
  average_score: number | null;
  axes: { axis: AuditAxis; average: number | null; audits: number }[];
  score_bands: { band: 'good' | 'fair' | 'poor'; count: number }[];
  links: {
    total: number;
    opened: number;
    open_rate: number | null;
    median_hours_to_first_open: number | null;
  };
  sources: { source: string; count: number }[];
  top_findings: { rule_code: string; label: string; axis: string; count: number }[];
  llm: { calls: number; tokens_in: number; tokens_out: number; vision_calls: number };
  /** Completed audits that ran the ai_readiness module. */
  ai_readiness: {
    audits: number;
    average_score: number | null;
    /** Audits under AI_READINESS_LOW_THRESHOLD. */
    low_count: number;
    top_failed_checks: { check_id: string; rule_code: string; label: string; count: number }[];
  };
}

export interface ApiError {
  error: string;
  message: string;
}

// -------------------------------------------------------------------------
// Report templates (REST /templates, MCP list_templates ... save_template)
// -------------------------------------------------------------------------

export const ApiTemplateIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/);

export interface ApiTemplateSummary {
  id: string;
  name: string;
  description: string;
  version: string;
  builtin: boolean;
  enabled: boolean;
  is_default: boolean;
  based_on: string | null;
}

export interface ApiTemplate extends ApiTemplateSummary {
  /** manifest.json, parsed. */
  manifest: unknown;
  /** Text files of the template (manifest.json, report.liquid, sections/*.liquid, report.css, print.css). */
  files: Record<string, string>;
  /** Stored values of the template settings. */
  settings: Record<string, unknown>;
  has_preview: boolean;
}

export interface ApiTemplateIssue {
  level: 'error' | 'warning';
  file: string | null;
  message: string;
}

const TemplateFilesSchema = z
  .record(z.string().max(300_000))
  .refine((f) => Object.keys(f).length <= 40, 'too many files');

export const ApiTemplatePreviewBodySchema = z
  .object({
    audit_id: z
      .string()
      .uuid()
      .optional()
      .describe('Render on this audit (default: the example audit).'),
    mode: z.enum(['web', 'print']).default('web'),
    settings: z.record(z.unknown()).optional().describe('Settings values to try (not saved).'),
    files: TemplateFilesSchema.optional().describe(
      'Draft files to render instead of the stored ones (not saved). Validated first.',
    ),
  })
  .strict();
export type ApiTemplatePreviewBody = z.infer<typeof ApiTemplatePreviewBodySchema>;

export interface ApiTemplatePreview {
  html: string;
  issues: ApiTemplateIssue[];
}

export const ApiTemplateSaveBodySchema = z
  .object({
    files: TemplateFilesSchema.describe('Every text file of the template, manifest.json included.'),
    preview_png_base64: z.string().max(1_400_000).optional(),
  })
  .strict();
export type ApiTemplateSaveBody = z.infer<typeof ApiTemplateSaveBodySchema>;

export interface ApiTemplateSaveResult {
  saved: boolean;
  created: boolean;
  issues: ApiTemplateIssue[];
}
