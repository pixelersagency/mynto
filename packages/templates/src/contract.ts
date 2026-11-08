import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * `report-data` contract, version 1.
 *
 * The single JSON object a report template receives. Every template (built-in
 * or imported) reads only this object: no database, no file system, no code.
 * Additive changes keep version 1; a removal or a change of meaning bumps the
 * version and templates declare the version they target in their manifest.
 *
 * Every key is always present (null or [] when there is nothing to show), so
 * templates can run with strict variables.
 *
 * Scores are integers on 100. Bands: 80-100 `good`, 50-79 `fair`, 0-49 `poor`.
 */

export const REPORT_DATA_CONTRACT = 'report-data' as const;
export const REPORT_DATA_VERSION = 1 as const;

export const ScoreBandSchema = z.enum(['good', 'fair', 'poor']);
export type ScoreBand = z.infer<typeof ScoreBandSchema>;

export const SeveritySchema = z.enum(['P0', 'P1', 'P2', 'P3']);

const ScoreSchema = z.object({
  value: z
    .number()
    .int()
    .min(0)
    .max(100)
    .nullable()
    .describe('Score on 100, null when not evaluated.'),
  band: ScoreBandSchema.nullable(),
  band_label: z.string().describe('« Bon », « À améliorer », « Critique » or « Non évalué ».'),
});

export const ReportFindingSchema = z.object({
  id: z.string(),
  anchor: z.string().describe('HTML id of the finding, unique in the report.'),
  axis: z.string(),
  axis_label: z.string(),
  severity: SeveritySchema,
  severity_label: z.string().describe('« Critique », « Important », « À améliorer », « Détail ».'),
  effort: z.enum(['quick_win', 'standard', 'important']).nullable(),
  effort_label: z.string().nullable(),
  title: z.string(),
  constat: z.string().nullable().describe('What was observed on the site.'),
  impact: z.string().nullable().describe('Why it matters for the business.'),
  recommendation: z.string().nullable(),
  code: z.string().nullable().describe('Code snippet, shown in a collapsible block.'),
  legal_refs: z.array(z.object({ label: z.string(), url: z.string().nullable() })),
  urls: z.array(z.string()).describe('Affected URLs (at most 10).'),
  urls_more: z.number().int().min(0).describe('Affected URLs not listed.'),
});
export type ReportFinding = z.infer<typeof ReportFindingSchema>;

export const ReportAxisSchema = z.object({
  id: z.string(),
  label: z.string(),
  short: z.string(),
  anchor: z.string(),
  evaluated: z.boolean().describe('False when the module was off: show « Non évalué », never 0.'),
  score: ScoreSchema,
  findings_count: z.number().int(),
  p0_count: z.number().int(),
  open_by_default: z
    .boolean()
    .describe('Section open on the web (P0 inside, or template setting).'),
  findings: z.array(ReportFindingSchema),
  passed: z.array(z.string()).describe('Checks of this axis that passed.'),
});
export type ReportAxis = z.infer<typeof ReportAxisSchema>;

export const ReportAiCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  description: z.string(),
  status: z.enum(['pass', 'fail', 'neutral', 'skipped']),
  status_label: z.string(),
  applicable: z.boolean(),
  message: z.string(),
  fix: z.string().nullable(),
  weight: z.number(),
});

export const ReportAiSchema = z.object({
  evaluated: z.boolean().describe('False when the module was off for this audit.'),
  failed: z.boolean().describe('True when the site could not be reached: no score.'),
  score: ScoreSchema,
  anchor: z.string(),
  level: z.number().int().nullable(),
  level_name: z.string().nullable(),
  max_level: z.number().int().nullable(),
  site_type_label: z.string().nullable(),
  site_type_auto: z.boolean(),
  included_in_global_score: z.boolean(),
  counts: z.object({ pass: z.number().int(), fail: z.number().int(), other: z.number().int() }),
  categories: z.array(
    z.object({ id: z.string(), label: z.string(), checks: z.array(ReportAiCheckSchema) }),
  ),
  top_fixes: z
    .array(ReportAiCheckSchema)
    .describe('Failed applicable checks, heaviest first (max 5).'),
});
export type ReportAi = z.infer<typeof ReportAiSchema>;

export const SectionIdSchema = z.enum([
  'summary',
  'priorities',
  'cost',
  'axes',
  'ai',
  'issues',
  'passed',
  'cta',
]);
export type SectionId = z.infer<typeof SectionIdSchema>;

export const SECTION_LABEL: Record<SectionId, string> = {
  summary: 'Résumé exécutif',
  priorities: 'Top 3 priorités',
  cost: 'Chiffrage',
  axes: 'Scores par axe',
  ai: 'Préparation IA',
  issues: 'Problèmes par axe',
  passed: 'Ce qui va bien',
  cta: 'Appel à l’action',
};

export const ReportDataV1Schema = z.object({
  contract: z.literal(REPORT_DATA_CONTRACT),
  version: z.literal(REPORT_DATA_VERSION),
  mode: z.enum(['web', 'print']).describe('`print` for the PDF: sections are expanded.'),
  generated_at: z.string(),
  audit: z.object({
    slug: z.string(),
    url: z.string(),
    host: z.string(),
    name: z.string().describe('Readable site name (label or host).'),
    created_at: z.string(),
    created_label: z.string().describe('« 6 novembre 2026 ».'),
    expires_at: z.string(),
    expires_label: z.string(),
    sector: z.string().nullable(),
    main_kpi: z.string().nullable(),
    stack: z.string().nullable(),
    hero_image_url: z.string().nullable(),
    favicon_url: z.string().nullable(),
    pages_analyzed: z.number().int().nullable(),
    llm_assisted: z.boolean(),
  }),
  score: ScoreSchema.extend({
    evaluated_axes: z.number().int(),
    total_axes: z.number().int(),
    partial: z.boolean().describe('True when some axes were not evaluated.'),
    ai_included: z.boolean().describe('True when Préparation IA counts in the global score.'),
  }),
  counts: z.object({
    P0: z.number().int(),
    P1: z.number().int(),
    P2: z.number().int(),
    P3: z.number().int(),
    total: z.number().int(),
  }),
  summary: z.object({ text: z.string().nullable(), impact: z.string().nullable() }),
  priorities: z.array(
    z.object({
      rank: z.number().int(),
      title: z.string(),
      reason: z.string(),
      expected_outcome: z.string().nullable(),
      findings: z.array(
        z.object({
          id: z.string(),
          anchor: z.string(),
          title: z.string(),
          severity: SeveritySchema,
        }),
      ),
    }),
  ),
  quick_wins: z.array(z.string()),
  cost: z
    .object({
      days: z.number(),
      days_label: z.string().describe('« 4,5 jours ».'),
      amount_low: z.number(),
      amount_high: z.number(),
      amount_label: z.string().describe('« 2 700 € à 3 300 € HT ».'),
      daily_rate: z.number(),
      daily_rate_label: z.string(),
      items_count: z.number().int(),
      verdict: z.enum(['correction_or_redesign', 'redesign_only']).nullable(),
      verdict_label: z.string().nullable(),
      redesign_reasons: z.array(z.string()),
      disclaimer: z.string(),
    })
    .nullable()
    .describe('Time-to-fix estimate, null when absent.'),
  axes: z.array(ReportAxisSchema).describe('The 8 axes, in report order.'),
  top_issues: z.array(ReportFindingSchema).describe('P0 and P1 findings, at most 6.'),
  ai: ReportAiSchema,
  passed: z.array(z.object({ axis_label: z.string(), label: z.string() })),
  agency: z.object({
    name: z.string(),
    initial: z.string(),
    website_url: z.string().nullable(),
    website_host: z.string().nullable(),
    contact_url: z.string().nullable(),
    logo_url: z.string().nullable(),
    color: z.string().describe('Brand color as chosen (#RRGGBB).'),
    color_text: z
      .string()
      .describe('Brand color darkened when needed so text and links reach 4.5:1 on white.'),
    color_adjusted: z.boolean(),
    on_color: z.string().describe('Readable text color on a brand-colored background.'),
    footer: z.string().nullable(),
  }),
  links: z.object({
    share_url: z.string().describe('Link to give: the /r/ tracking link when there is one.'),
    pdf_url: z.string(),
  }),
  tracking: z.object({
    enabled: z.boolean().describe('True on /r/ tracking links.'),
    notice: z.string().describe('Short tracking notice (required on /r/).'),
  }),
  texts: z.object({
    intro: z.string().nullable(),
    cta_title: z.string(),
    cta_text: z.string(),
    cta_label: z.string(),
    footer: z.string().nullable(),
    disclaimer: z.string(),
  }),
  sections: z
    .array(z.object({ id: SectionIdSchema, label: z.string(), enabled: z.boolean() }))
    .describe('Sections in display order, as configured in the template settings.'),
  settings: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null()]))
    .describe('Values of the template settings declared in its manifest.'),
  template: z.object({ id: z.string(), name: z.string(), version: z.string() }),
});
export type ReportDataV1 = z.infer<typeof ReportDataV1Schema>;

/** JSON Schema of the contract (docs/templates/report-data.schema.json). */
export function reportDataJsonSchema(): Record<string, unknown> {
  const schema = zodToJsonSchema(ReportDataV1Schema, {
    name: 'ReportDataV1',
    $refStrategy: 'none',
  }) as Record<string, unknown>;
  return {
    $id: 'https://mynto.fr/schemas/report-data.v1.json',
    title: 'Mynto report-data v1',
    description:
      'Data passed to a report template. Scores are integers on 100. Every key is always present.',
    ...schema,
  };
}

export function scoreBand(value: number | null): ScoreBand | null {
  if (value === null) return null;
  if (value >= 80) return 'good';
  if (value >= 50) return 'fair';
  return 'poor';
}

export const BAND_LABEL: Record<ScoreBand, string> = {
  good: 'Bon',
  fair: 'À améliorer',
  poor: 'Critique',
};
