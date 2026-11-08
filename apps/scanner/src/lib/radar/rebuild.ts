import { z } from 'zod';

import type { RunInput } from '../../audit/llm/client.js';
import { AxisEnum, BandEnum, EffortEnum, SeverityEnum } from '../../audit/llm/output-schema.js';
import type { AuditFacts, AxisScore, Finding, LegalRef } from '../../audit/types.js';

/**
 * Rebuilds the LLM `RunInput` of a finished audit from what was persisted
 * in Postgres, so the narrative call can run long after the scan (Radar
 * deferred interpretation).
 *
 * Sources:
 *   - `audits_full.facts`          -> facts (validated on the fields the prompt reads)
 *   - `audit_findings_full` rows   -> findings (the shape `buildUserPrompt` expects)
 *   - `audits_full.axis_scores`    -> scores
 *   - `audits_full.llm_input`      -> sectorHints, internalPagesSample, homeHtmlExcerpt
 *
 * Every source is untrusted JSON from the database: each one goes through
 * Zod before being handed to the prompt builder.
 */

const LegalRefSchema = z.object({
  standard: z.enum(['RGAA', 'WCAG', 'RGPD', 'LCEN', 'EAA', 'CNIL', 'GOOGLE']),
  version: z.string().optional(),
  criterion: z.string().optional(),
  url: z.string().optional(),
  label: z.string(),
});

export const FindingRowSchema = z.object({
  id: z.string().min(1),
  rule_code: z.string().min(1),
  axis: AxisEnum,
  severity: SeverityEnum,
  effort: EffortEnum.nullable(),
  title: z.string(),
  evidence: z.record(z.unknown()).nullable().default({}),
  affected_urls: z.array(z.string()).nullable().default([]),
  legal_refs: z.array(LegalRefSchema).nullable().default([]),
});
export type FindingRow = z.infer<typeof FindingRowSchema>;

const AxisScoreEntrySchema = z.object({
  score: z.number(),
  band: BandEnum,
  weight: z.number(),
});
const AxisScoresSchema = z.record(z.string(), AxisScoreEntrySchema);

export const PersistedLlmInputSchema = z.object({
  sectorHints: z
    .object({
      detected: z.string().optional(),
      confidence: z.number().optional(),
      mainKpi: z.string().optional(),
      secondaryKpi: z.string().optional(),
      audienceNotes: z.string().optional(),
    })
    .default({}),
  internalPagesSample: z.array(z.string()).max(200).default([]),
  homeHtmlExcerpt: z.string().max(30_000).default(''),
});

/**
 * Minimal structural check of `facts`: the top-level sections
 * `buildUserPrompt` dereferences must exist. The full AuditFacts type is
 * too large to mirror field by field, and the rows were written by our own
 * scanner, so this guards against truncated or foreign JSON rather than
 * re-validating every leaf.
 */
const FactsShapeSchema = z
  .object({
    url: z.string(),
    stack: z.object({}).passthrough(),
    meta: z
      .object({
        og: z.record(z.unknown()),
        twitter: z.record(z.unknown()),
        hreflangs: z.array(z.unknown()),
      })
      .passthrough(),
    http: z.object({}).passthrough(),
    sitemap: z.object({}).passthrough(),
    robots: z.object({}).passthrough(),
    legal: z.object({}).passthrough(),
    images: z.object({}).passthrough(),
    headings: z.object({}).passthrough(),
    conversion: z.object({}).passthrough(),
    content: z.object({}).passthrough(),
    ux: z.object({}).passthrough(),
    ui: z.object({}).passthrough(),
    lighthouse: z.object({}).passthrough(),
    axe: z.object({ violations: z.array(z.unknown()) }).passthrough(),
  })
  .passthrough();

/** Canonical axis order, used so the rebuilt scores are stable. */
const AXIS_ORDER = AxisEnum.options;

export function findingFromRow(row: FindingRow): Finding {
  return {
    id: row.id,
    ruleCode: row.rule_code,
    axis: row.axis,
    severity: row.severity,
    title: row.title,
    evidence: row.evidence ?? {},
    affectedUrls: row.affected_urls ?? [],
    legalRefs: (row.legal_refs ?? []) as LegalRef[],
    effortDefault: row.effort ?? 'standard',
    // Neither is persisted. Both only matter to scoring and the time-to-fix
    // chiffrage, which ran at scan time and are not recomputed here.
    kind: 'deterministic',
    occurrences: 1,
  };
}

export function scoresFromAxisMap(raw: unknown): AxisScore[] {
  const parsed = AxisScoresSchema.parse(raw);
  const out: AxisScore[] = [];
  for (const axis of AXIS_ORDER) {
    const entry = parsed[axis];
    if (entry) out.push({ axis, score: entry.score, band: entry.band, weight: entry.weight });
  }
  return out;
}

export interface PersistedAuditRows {
  facts: unknown;
  axisScores: unknown;
  llmInput: unknown;
  findingRows: unknown[];
}

export type RebuildResult = { ok: true; input: RunInput } | { ok: false; error: string };

export function rebuildRunInput(rows: PersistedAuditRows): RebuildResult {
  const facts = FactsShapeSchema.safeParse(rows.facts);
  if (!facts.success) return { ok: false, error: 'invalid_facts' };

  const llmInput = PersistedLlmInputSchema.safeParse(rows.llmInput ?? {});
  if (!llmInput.success) return { ok: false, error: 'invalid_llm_input' };

  let scores: AxisScore[];
  try {
    scores = scoresFromAxisMap(rows.axisScores);
  } catch {
    return { ok: false, error: 'invalid_axis_scores' };
  }
  if (scores.length === 0) return { ok: false, error: 'no_axis_scores' };

  const findings: Finding[] = [];
  for (const raw of rows.findingRows) {
    const parsed = FindingRowSchema.safeParse(raw);
    if (parsed.success) findings.push(findingFromRow(parsed.data));
  }
  // The LLM output schema requires at least one finding narrative: an
  // audit with zero findings has nothing to interpret.
  if (findings.length === 0) return { ok: false, error: 'no_findings' };

  return {
    ok: true,
    input: {
      // Structural check above; the rows were written by this scanner.
      facts: facts.data as unknown as AuditFacts,
      findings,
      scores,
      sectorHints: llmInput.data.sectorHints,
      internalPagesSample: llmInput.data.internalPagesSample,
      homeHtmlExcerpt: llmInput.data.homeHtmlExcerpt,
    },
  };
}
