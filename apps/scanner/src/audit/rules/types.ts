import type {
  AuditAxis,
  AuditFacts,
  Effort,
  Finding,
  FindingKind,
  LegalRef,
  Severity,
} from '../types.js';

export interface RuleContext {
  facts: AuditFacts;
  origin: string;
}

export interface RuleDefinition {
  code: string;
  axis: AuditAxis;
  defaultSeverity: Severity;
  defaultEffort: Effort;
  /**
   * Nature of every finding this rule emits. Omitted = `deterministic`
   * (the default for the 34 DOM/measurement rules). The vision-driven
   * UI/UX rules set this to `qualitative` so they stay out of the score
   * penalty and the chiffrage.
   */
  kind?: FindingKind;
  /** Factual observation without a validated failure threshold. Must not
   * reduce a score or receive an automatic remediation estimate. */
  advisory?: boolean;
  /** Returns Finding(s) if the rule fires, empty array otherwise. */
  evaluate: (ctx: RuleContext) => Finding[] | Finding | null;
}

export function makeFinding(
  rule: RuleDefinition,
  parts: {
    title: string;
    evidence: Record<string, unknown>;
    affectedUrls?: string[];
    legalRefs?: LegalRef[];
    severity?: Severity;
    effort?: Effort;
    /** Occurrence count for the chiffrage. Defaults to 1 (one-shot). */
    occurrences?: number;
  },
): Finding {
  return {
    id: `${rule.code}:${stableShort(parts.title + JSON.stringify(parts.evidence))}`,
    ruleCode: rule.code,
    axis: rule.axis,
    severity: parts.severity ?? rule.defaultSeverity,
    title: parts.title,
    evidence: parts.evidence,
    affectedUrls: parts.affectedUrls ?? [],
    legalRefs: parts.legalRefs ?? [],
    effortDefault: parts.effort ?? rule.defaultEffort,
    kind: rule.kind ?? 'deterministic',
    ...(rule.advisory ? { advisory: true } : {}),
    occurrences: Math.max(1, Math.floor(parts.occurrences ?? 1)),
  };
}

function stableShort(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).slice(0, 10);
}
