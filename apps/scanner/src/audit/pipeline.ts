import type { AiReadinessResult } from '@mynto/shared';

import { failedStoredResult } from './ai-readiness/index.js';
import { runAuditLlm, type LlmConfig, type RunOutcome } from './llm/client.js';
import type { LlmAuditOutput } from './llm/output-schema.js';
import { applyFindingNarratives, buildNarrativeFields, computeGlobalScore } from './narrative.js';
import { decideRemediation } from './remediation/arbitrage.js';
import { estimateRemediation, type ChiffrageOptions } from './remediation/chiffrage.js';
import { evaluatedAxisScores } from './scoring.js';
import type { AuditFacts, AuditReport, AxisScore, Finding, SectorContext } from './types.js';

/**
 * Orchestrator for the full-audit pipeline.
 *
 *   1. COLLECT (deterministic, parallel where safe)
 *        - HTTP probe, HTML render via Playwright, sample 5 internal pages
 *        - Meta/OG/JSON-LD extraction, image audit, heading audit
 *        - Resilient discovery of sitemap, robots, legal/conversion pages
 *        - Stack detection (drives the resilient discovery)
 *        - Lighthouse + axe-core
 *
 *   2. APPLY RULES (deterministic)
 *        - Each axis emits Finding[] with evidence and legal refs
 *        - Scoring per axis is computed from finding severities
 *
 *   3. LLM BATCH (single call, Gemini 2.5 Flash by default; skipped when
 *      `deps.skipLlm`, the narrative then runs later from persisted data)
 *        - Receives facts + findings + scores + sector hints
 *        - Produces sector, narratives per finding, exec summary, top3, quickWins
 *        - Output strictly validated against Zod + cross-checked against finding ids
 *
 *   4. ASSEMBLE
 *        - Merge LLM narrative back into deterministic findings (LLM cannot
 *          modify ids, legalRefs, evidence, or scores)
 *        - Return AuditReport ready for rendering
 *
 * Collector stubs are imported lazily so this file can typecheck before each
 * collector lands. Each `collect*` function is expected to throw on hard
 * failure; soft failures append to `facts.errors`.
 */

export interface PipelineDeps {
  collect: (url: string) => Promise<AuditFacts>;
  applyRules: (facts: AuditFacts) => Finding[];
  scoreAxes: (facts: AuditFacts, findings: Finding[]) => AxisScore[];
  deriveSectorHints: (facts: AuditFacts) => Partial<SectorContext>;
  pickInternalSample: (facts: AuditFacts) => string[];
  pickHomeHtmlExcerpt: (facts: AuditFacts) => string;
  llmConfig: LlmConfig;
  /**
   * Skip the narrative LLM call entirely (Radar audits, cost control).
   * The report is assembled with the deterministic fallbacks and the
   * LLM inputs are returned in `llmInput` so the narrative can be run
   * later from persisted data (see queue/radar-interpret-processor.ts).
   */
  skipLlm?: boolean;
  /** Agency daily rate + billable hours for the time-to-fix chiffrage. */
  costConfig?: ChiffrageOptions;
  /**
   * Préparation IA module. `run` starts with the collectors (independent
   * HTTP probes) and never throws. Its result is NOT given to the LLM.
   * `includeInGlobalScore` folds the AI score (/10, weight
   * AI_READINESS_GLOBAL_WEIGHT) into the global score. Absent = module off,
   * the report is exactly the 8-axis one.
   */
  aiReadiness?: {
    run: () => Promise<AiReadinessResult>;
    includeInGlobalScore: boolean;
  };
  logger: {
    info: (o: unknown, m?: string) => void;
    warn: (o: unknown, m?: string) => void;
    error: (o: unknown, m?: string) => void;
  };
}

export interface RunFullAuditResult {
  report: AuditReport;
  llmUsed: boolean;
  llmTokensIn: number;
  llmTokensOut: number;
  llmDurationMs: number;
  llmAttempts: number;
  llmError?: string;
  /** Inputs that only exist in memory during the scan, needed to replay the LLM call later. */
  llmInput: PersistedLlmInput;
}

/** Shape persisted in `audits_full.llm_input` for deferred interpretation. */
export interface PersistedLlmInput {
  sectorHints: Partial<SectorContext>;
  internalPagesSample: string[];
  /** Home HTML excerpt, capped at HOME_HTML_EXCERPT_MAX characters. */
  homeHtmlExcerpt: string;
}

export const HOME_HTML_EXCERPT_MAX = 30_000;

/** Weight of the Préparation IA score in the global score, when included (axes weigh 0.6 to 1.2). */
export const AI_READINESS_GLOBAL_WEIGHT = 1.0;

export async function runFullAudit(url: string, deps: PipelineDeps): Promise<RunFullAuditResult> {
  const t0 = Date.now();
  deps.logger.info({ url }, 'audit_full_start');

  // Started first: its probes run while the collectors work.
  const aiPromise = deps.aiReadiness
    ? deps.aiReadiness
        .run()
        .catch((err: unknown) =>
          failedStoredResult('auto', err instanceof Error ? err.name : 'ai_readiness_failed'),
        )
    : null;

  const facts = await deps.collect(url);
  deps.logger.info(
    {
      url,
      stack: facts.stack.stack,
      sitemapFound: facts.sitemap.found,
      errors: facts.errors.length,
    },
    'audit_full_collected',
  );

  const findings = deps.applyRules(facts);
  const scores = evaluatedAxisScores(deps.scoreAxes(facts, findings), facts);
  const sectorHints = deps.deriveSectorHints(facts);
  const internalPagesSample = deps.pickInternalSample(facts);
  const homeHtmlExcerpt = deps.pickHomeHtmlExcerpt(facts);

  const llmResult: RunOutcome = deps.skipLlm
    ? {
        ok: false,
        provider: deps.llmConfig.provider,
        model: deps.llmConfig.model,
        durationMs: 0,
        attempts: 0,
      }
    : await runAuditLlm(
        { facts, findings, scores, sectorHints, internalPagesSample, homeHtmlExcerpt },
        deps.llmConfig,
      );

  const aiReadiness = aiPromise === null ? undefined : await aiPromise;

  const report = assembleReport({
    facts,
    findings,
    scores,
    sectorHints,
    llmOutput: llmResult.ok ? llmResult.output : undefined,
    costConfig: deps.costConfig,
    aiReadiness,
    aiInGlobalScore: deps.aiReadiness?.includeInGlobalScore ?? false,
  });

  deps.logger.info(
    {
      url,
      durationMs: Date.now() - t0,
      llmOk: llmResult.ok,
      llmSkipped: deps.skipLlm === true,
      llmError: llmResult.error,
      llmAttempts: llmResult.attempts,
      tokensIn: llmResult.tokensIn,
      tokensOut: llmResult.tokensOut,
    },
    'audit_full_done',
  );

  return {
    report,
    llmUsed: llmResult.ok,
    llmTokensIn: llmResult.tokensIn ?? 0,
    llmTokensOut: llmResult.tokensOut ?? 0,
    llmDurationMs: llmResult.durationMs,
    llmAttempts: llmResult.attempts,
    llmError: llmResult.error,
    llmInput: {
      sectorHints,
      internalPagesSample,
      homeHtmlExcerpt: homeHtmlExcerpt.slice(0, HOME_HTML_EXCERPT_MAX),
    },
  };
}

interface AssembleInput {
  facts: AuditFacts;
  findings: Finding[];
  scores: AxisScore[];
  sectorHints: Partial<SectorContext>;
  llmOutput?: LlmAuditOutput;
  costConfig?: ChiffrageOptions;
  aiReadiness?: AiReadinessResult;
  aiInGlobalScore?: boolean;
}

/** Extra global-score entry of the Préparation IA score, when the install includes it. */
export function aiGlobalScoreEntry(
  ai: AiReadinessResult | undefined,
  include: boolean,
): { score: number; weight: number }[] {
  if (!include || ai?.status !== 'completed' || ai.score === null) return [];
  return [{ score: ai.score / 10, weight: AI_READINESS_GLOBAL_WEIGHT }];
}

function assembleReport(input: AssembleInput): AuditReport {
  const { facts, findings, scores, sectorHints, llmOutput, costConfig } = input;

  applyFindingNarratives(findings, llmOutput);

  const aiExtra = aiGlobalScoreEntry(input.aiReadiness, input.aiInGlobalScore ?? false);
  const { globalScore, globalBand } = computeGlobalScore(scores, aiExtra);
  const aiReadiness =
    input.aiReadiness === undefined
      ? undefined
      : { ...input.aiReadiness, included_in_global_score: aiExtra.length > 0 };

  // cost the deterministic findings in dev time, then
  // decide whether the report offers a quick correction or pushes straight
  // to a redesign. Both are pure functions of facts + findings + scores.
  const costEstimate = estimateRemediation(findings, facts, costConfig);
  const remediation = decideRemediation(facts, scores);

  const narrative = buildNarrativeFields({
    facts,
    findings,
    scores,
    sectorHints,
    globalScore,
    llmOutput,
  });

  return {
    url: facts.url,
    scannedAt: facts.scannedAt,
    sector: narrative.sector,
    scores,
    globalScore,
    globalBand,
    findings,
    killerFindings: narrative.killerFindings,
    execSummary: narrative.execSummary,
    top3Priorities: narrative.top3Priorities,
    quickWins: narrative.quickWins,
    estimatedImpactNarrative: narrative.estimatedImpactNarrative,
    costEstimate,
    remediation,
    facts,
    ...(aiReadiness === undefined ? {} : { aiReadiness }),
  };
}
