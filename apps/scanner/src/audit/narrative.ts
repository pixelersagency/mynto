import type { LlmAuditOutput } from './llm/output-schema.js';
import type { AuditFacts, AuditReport, AxisScore, Finding, SectorContext } from './types.js';

/**
 * Narrative layer of the full audit, shared by the synchronous pipeline
 * (`assembleReport`) and the deferred Radar interpretation
 * (`queue/radar-interpret-processor.ts`).
 *
 * Both paths MUST apply the LLM output the same way, so the logic lives
 * here once: the LLM can only rewrite title / severity / effort and the
 * narrative of a finding it was given, never ids, evidence, legal refs or
 * scores. When there is no LLM output, the deterministic fallbacks below
 * produce a readable report on their own.
 */

/** Mutates `findings` in place with the LLM narrative, matched by id. */
export function applyFindingNarratives(findings: Finding[], llmOutput?: LlmAuditOutput): void {
  if (!llmOutput) return;
  const byId = new Map(findings.map((f) => [f.id, f] as const));
  for (const narr of llmOutput.findings) {
    const f = byId.get(narr.findingId);
    if (!f) continue;
    f.narrative = {
      constat: narr.constat,
      impactBusiness: narr.impactBusiness,
      recommandation: narr.recommandation,
      codeSnippet: narr.codeSnippet,
    };
    f.title = narr.title;
    f.severity = narr.severity;
    f.effortDefault = narr.effort;
  }
}

export type NarrativeFields = Pick<
  AuditReport,
  | 'sector'
  | 'killerFindings'
  | 'execSummary'
  | 'top3Priorities'
  | 'quickWins'
  | 'estimatedImpactNarrative'
>;

export interface NarrativeInput {
  facts: AuditFacts;
  findings: Finding[];
  scores: AxisScore[];
  sectorHints: Partial<SectorContext>;
  globalScore: number | null;
  llmOutput?: LlmAuditOutput;
}

/** Report-level narrative fields, from the LLM output or the fallbacks. */
export function buildNarrativeFields(input: NarrativeInput): NarrativeFields {
  const { facts, findings, scores, sectorHints, globalScore, llmOutput } = input;
  return {
    sector: llmOutput?.sector ?? {
      detected: sectorHints.detected ?? 'générique',
      confidence: sectorHints.confidence ?? 0,
      mainKpi: sectorHints.mainKpi ?? 'conversions',
      secondaryKpi: sectorHints.secondaryKpi ?? 'trafic organique',
      audienceNotes: sectorHints.audienceNotes ?? '',
    },
    killerFindings: llmOutput?.killerFindings ?? [],
    execSummary:
      llmOutput?.execSummary ?? buildFallbackSummary(facts, findings, scores, globalScore),
    top3Priorities:
      llmOutput?.top3Priorities.map((p) => ({
        title: p.title,
        reason: p.reason,
        findingIds: p.findingIds ?? (p.findingId ? [p.findingId] : []),
        expectedOutcome: p.expectedOutcome,
      })) ?? pickFallbackTop3(findings),
    quickWins: llmOutput?.quickWins ?? pickFallbackQuickWins(findings),
    estimatedImpactNarrative:
      llmOutput?.estimatedImpactNarrative ??
      'Les priorités P0 et P1 listées concentrent l’essentiel du potentiel.',
  };
}

/**
 * Weighted mean of the axis scores (0-10). `extra` adds scored entries
 * outside the 8 axes, e.g. the Préparation IA score when the install folds
 * it into the global score. Without `extra` the output is unchanged.
 */
export function computeGlobalScore(
  scores: AxisScore[],
  extra: readonly { score: number; weight: number }[] = [],
): {
  globalScore: number | null;
  globalBand: AxisScore['band'] | null;
} {
  const all = [...scores, ...extra];
  if (all.length === 0) return { globalScore: null, globalBand: null };
  const totalWeight = all.reduce((acc, s) => acc + s.weight, 0) || 1;
  const weightedSum = all.reduce((acc, s) => acc + s.score * s.weight, 0);
  const globalScore = Math.round((weightedSum / totalWeight) * 10) / 10;
  return { globalScore, globalBand: bandFromScore(globalScore) };
}

export function bandFromScore(score: number): AxisScore['band'] {
  if (score >= 9) return 'excellent';
  if (score >= 7) return 'good';
  if (score >= 5) return 'fair';
  if (score >= 3) return 'poor';
  return 'critical';
}

function buildFallbackSummary(
  facts: AuditFacts,
  findings: Finding[],
  scores: AxisScore[],
  globalScore: number | null,
): string {
  const p0 = findings.filter((f) => f.severity === 'P0').length;
  const p1 = findings.filter((f) => f.severity === 'P1').length;
  const worstAxes = [...scores]
    .sort((a, b) => a.score - b.score)
    .slice(0, 2)
    .map((s) => s.axis)
    .join(', ');
  return [
    `Audit du site ${facts.url}.`,
    globalScore === null
      ? 'Score global : Non évalué.'
      : `Score global ${Math.round(globalScore * 10).toString()}/100.`,
    `${p0.toString()} point(s) critique(s) (P0), ${p1.toString()} important(s) (P1).`,
    `Axes les plus faibles : ${worstAxes}.`,
    'Détail par axe ci-dessous.',
  ].join(' ');
}

function pickFallbackTop3(findings: Finding[]): AuditReport['top3Priorities'] {
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
  const sorted = [...findings].sort((a, b) => order[a.severity] - order[b.severity]);
  return sorted.slice(0, 3).map((f) => ({
    title: f.title,
    reason: `Sévérité ${f.severity}, axe ${f.axis}.`,
  }));
}

function pickFallbackQuickWins(findings: Finding[]): string[] {
  return findings
    .filter((f) => f.effortDefault === 'quick_win' && (f.severity === 'P0' || f.severity === 'P1'))
    .slice(0, 8)
    .map((f) => f.title);
}
