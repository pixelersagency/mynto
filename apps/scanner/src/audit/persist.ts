import type { AuditPatch } from '@mynto/db';

import type { AuditReport, AxisScore, Finding } from './types.js';

/**
 * Row mappers between the in-memory audit shapes and the Postgres tables
 * `audits_full` / `audit_findings_full`. Shared by the full-audit
 * processor and the deferred Radar interpretation so both write the same
 * columns the same way.
 */

export interface AuditFindingFullRow {
  id: string;
  audit_id: string;
  rule_code: string;
  axis: string;
  severity: string;
  effort: string | null;
  title: string;
  evidence: Record<string, unknown>;
  affected_urls: string[];
  legal_refs: Finding['legalRefs'];
  narrative_constat: string | null;
  narrative_impact_business: string | null;
  narrative_recommandation: string | null;
  narrative_code_snippet: string | null;
}

export function findingToRow(f: Finding, auditId: string): AuditFindingFullRow {
  return {
    id: f.id,
    audit_id: auditId,
    rule_code: f.ruleCode,
    axis: f.axis,
    severity: f.severity,
    effort: f.effortDefault,
    title: f.title,
    evidence: f.evidence,
    affected_urls: f.affectedUrls,
    legal_refs: f.legalRefs,
    narrative_constat: f.narrative?.constat ?? null,
    narrative_impact_business: f.narrative?.impactBusiness ?? null,
    narrative_recommandation: f.narrative?.recommandation ?? null,
    narrative_code_snippet: f.narrative?.codeSnippet ?? null,
  };
}

export type AxisScoresMap = Record<string, { score: number; band: string; weight: number }>;

export function axisScoresToMap(scores: AxisScore[]): AxisScoresMap {
  const out: AxisScoresMap = {};
  for (const s of scores) {
    out[s.axis] = { score: s.score, band: s.band, weight: s.weight };
  }
  return out;
}

/** Narrative columns of `audits_full`, written by both the scan and the deferred interpretation. */
export function narrativeColumns(
  r: Pick<
    AuditReport,
    | 'sector'
    | 'execSummary'
    | 'top3Priorities'
    | 'quickWins'
    | 'killerFindings'
    | 'estimatedImpactNarrative'
  >,
): Omit<AuditPatch, 'status'> {
  return {
    sector: r.sector.detected,
    sector_confidence: r.sector.confidence,
    main_kpi: r.sector.mainKpi,
    secondary_kpi: r.sector.secondaryKpi,
    exec_summary: r.execSummary,
    top3_priorities: r.top3Priorities,
    quick_wins: r.quickWins,
    killer_findings: r.killerFindings,
    estimated_impact_narrative: r.estimatedImpactNarrative,
  };
}
