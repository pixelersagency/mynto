import type { AiSiteTypeInput } from '@mynto/shared';

import { logger as pinoLogger } from '../logger.js';

import { runAiReadiness } from './ai-readiness/index.js';
import { collectAll, deriveSectorHints, type CollectAllOptions } from './collectors/index.js';
import type { LlmConfig } from './llm/client.js';
import { runFullAudit, type PipelineDeps, type RunFullAuditResult } from './pipeline.js';
import type { ChiffrageOptions } from './remediation/chiffrage.js';
import { applyAllRules } from './rules/index.js';
import { scoreAxes } from './scoring.js';
import type { AuditAxis, AuditFacts, AxisScore, Finding, SectorContext } from './types.js';

export type RunAuditOptions = CollectAllOptions & {
  /** Agency daily rate + billable hours for the time-to-fix chiffrage. */
  costConfig?: ChiffrageOptions;
  /** Skip the narrative LLM call (Radar audits). See PipelineDeps.skipLlm. */
  skipLlm?: boolean;
  /** Axes to evaluate (audit modules). All 8 when omitted. */
  axes?: readonly AuditAxis[];
  /** Préparation IA module (audit modules). Off when omitted. */
  aiReadiness?: { siteType: AiSiteTypeInput; includeInGlobalScore: boolean };
  /** Called when the audit moves to the next step (live progress in the dashboard). */
  onPhase?: (phase: 'analysis' | 'writing') => void;
};

/**
 * High-level entry point. Wires the collectors, rules, and scoring into the
 * generic pipeline. Caller only supplies a URL and an LLM config.
 */
export async function runAudit(
  url: string,
  llmConfig: LlmConfig,
  logger?: PipelineDeps['logger'],
  options: RunAuditOptions = {},
): Promise<RunFullAuditResult> {
  let cachedHomeHtml = '';

  const deps: PipelineDeps = {
    collect: async (u) => {
      const collected = await collectAll(u, options);
      cachedHomeHtml = collected.homeHtml;
      options.onPhase?.('analysis');
      return collected.facts;
    },
    applyRules: (facts) => {
      const findings = applyAllRules(facts, options.axes);
      if (!options.skipLlm) options.onPhase?.('writing');
      return findings;
    },
    scoreAxes: (_facts, findings) => scoreAxes(findings, options.axes),
    deriveSectorHints: (facts) =>
      deriveSectorHints({ facts, homeText: extractPlainText(cachedHomeHtml) }),
    pickInternalSample: (facts) => facts.internalPagesCrawled.map((p) => p.url),
    pickHomeHtmlExcerpt: () => cachedHomeHtml.slice(0, 30_000),
    llmConfig,
    skipLlm: options.skipLlm,
    costConfig: options.costConfig,
    logger: logger ?? defaultLogger,
  };
  const ai = options.aiReadiness;
  if (ai !== undefined) {
    deps.aiReadiness = {
      run: () => runAiReadiness(url, deps.logger, ai.siteType),
      includeInGlobalScore: ai.includeInGlobalScore,
    };
  }

  return runFullAudit(url, deps);
}

function extractPlainText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const defaultLogger: PipelineDeps['logger'] = {
  info: (o, m) => {
    pinoLogger.info(o as object, m);
  },
  warn: (o, m) => {
    pinoLogger.warn(o as object, m);
  },
  error: (o, m) => {
    pinoLogger.error(o as object, m);
  },
};

export type { AuditFacts, Finding, AxisScore, SectorContext };
export type { LlmConfig } from './llm/client.js';
export type { PersistedLlmInput, PipelineDeps, RunFullAuditResult } from './pipeline.js';
