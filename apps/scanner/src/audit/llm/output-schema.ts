import { z } from 'zod';

/**
 * Strict Zod schema for the single LLM batch call output.
 *
 * Why strict: every field is validated before being persisted or rendered.
 * The LLM is constrained to:
 *   - Reuse exact finding IDs we provided (cannot invent findings)
 *   - Stay within enum severities, axes, efforts
 *   - Provide bounded-length text (no runaway tokens)
 *   - Never modify legalRefs, scores, or evidence (those stay deterministic)
 *
 * If validation fails, we fall back to the deterministic skeleton output and
 * log the violation for prompt tuning.
 */

export const AxisEnum = z.enum([
  'ux',
  'ui',
  'seo_technique',
  'seo_contenu',
  'performance',
  'accessibilite',
  'conformite',
  'conversion',
]);

export const SeverityEnum = z.enum(['P0', 'P1', 'P2', 'P3']);
export const EffortEnum = z.enum(['quick_win', 'standard', 'important']);
export const BandEnum = z.enum(['excellent', 'good', 'fair', 'poor', 'critical']);

export const SectorContextSchema = z.object({
  detected: z.string().min(2).max(80),
  confidence: z.number().min(0).max(1),
  mainKpi: z.string().min(3).max(120),
  secondaryKpi: z.string().min(3).max(120),
  audienceNotes: z.string().min(0).max(500),
});

export const FindingNarrativeSchema = z.object({
  /** Identifier from the deterministic findings list — LLM may not invent. */
  findingId: z.string().min(1).max(80),
  /** Refined title: short, business-oriented, no jargon. */
  title: z.string().min(8).max(200),
  /** Factual observation. Must match evidence, no embellishment. */
  constat: z.string().min(20).max(1500),
  /**
   * Business impact tied to the sector's primary KPI, with formula and ranges.
   * Higher cap because the consultant tone demands explicit math:
   * "Si trafic ~X, panier Y, taux Z%, perte estimée A à B€/mois (source ...)".
   */
  impactBusiness: z.string().min(20).max(2000),
  /** Concrete, actionable recommendation. */
  recommandation: z.string().min(20).max(1500),
  /** Optional code snippet ready to paste, in fenced block. */
  codeSnippet: z.string().max(2500).optional(),
  /** LLM may downgrade/upgrade only by 1 step relative to default. */
  severity: SeverityEnum,
  effort: EffortEnum,
});

/**
 * A strategic lever groups 2 to 5 findings under a business theme.
 * Replaces the old "1 priority = 1 finding" model, which produced flat
 * checklists. The lever forces the LLM to demonstrate cross-axis
 * reasoning and to chiffrage explicitly.
 *
 * Back-compat: `findingId` is kept optional for legacy LLM responses that
 * only cite a single finding. The renderer falls back to first id in
 * findingIds when not set.
 */
export const Top3PrioritySchema = z.object({
  /** Lever title — must be a strategic theme, not a finding name. */
  title: z.string().min(8).max(160),
  /**
   * Explains WHY the grouped findings form a coherent signal AND what
   * happens when they're corrected together. The renderer treats this
   * as the lever rationale.
   */
  reason: z.string().min(20).max(2000),
  /**
   * Finding ids grouped under this lever (2-5 expected). Must each
   * exist in the deterministic findings set.
   */
  findingIds: z.array(z.string().min(1).max(80)).min(1).max(8).optional(),
  /**
   * Chiffrage explicite avec formule : "Si trafic ~X, panier Y → +A à B%".
   * Optionnel pour back-compat, mais l'instruction prompt l'exige.
   */
  expectedOutcome: z.string().min(0).max(1500).optional(),
  /** Legacy: single finding id. Falls back to findingIds[0] when set. */
  findingId: z.string().min(1).max(80).optional(),
});

export const LlmAuditOutputSchema = z.object({
  sector: SectorContextSchema,
  /** Exec summary now demands a richer cross-axis synthesis; cap raised. */
  execSummary: z.string().min(80).max(3000),
  globalBand: BandEnum,
  top3Priorities: z.array(Top3PrioritySchema).length(3),
  quickWins: z.array(z.string().min(10).max(400)).min(0).max(10),
  killerFindings: z.array(z.string().min(1).max(80)).min(0).max(5),
  estimatedImpactNarrative: z.string().min(40).max(2000),
  findings: z.array(FindingNarrativeSchema).min(1).max(80),
});

export type LlmAuditOutput = z.infer<typeof LlmAuditOutputSchema>;

/**
 * Cross-field validation we apply after Zod parses successfully.
 * Returns null if everything is consistent, or a message otherwise.
 */
export function validateAgainstDeterministic(
  output: LlmAuditOutput,
  knownFindingIds: Set<string>,
): string | null {
  for (const f of output.findings) {
    if (!knownFindingIds.has(f.findingId)) {
      return `LLM hallucinated finding id "${f.findingId}" not in deterministic set`;
    }
  }
  for (const p of output.top3Priorities) {
    const ids = p.findingIds ?? (p.findingId ? [p.findingId] : []);
    if (ids.length === 0) {
      return 'Top3 lever has no findingIds and no findingId';
    }
    for (const id of ids) {
      if (!knownFindingIds.has(id)) {
        return `LLM cited unknown finding id "${id}" in top3 lever "${p.title}"`;
      }
    }
  }
  return null;
}
