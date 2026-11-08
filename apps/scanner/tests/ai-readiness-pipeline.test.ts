import type { AiReadinessResult } from '@mynto/shared';
import { describe, expect, it, vi } from 'vitest';

import { failedStoredResult } from '../src/audit/ai-readiness/index.js';
import { computeGlobalScore } from '../src/audit/narrative.js';
import {
  AI_READINESS_GLOBAL_WEIGHT,
  runFullAudit,
  type PipelineDeps,
} from '../src/audit/pipeline.js';
import { applyAllRules } from '../src/audit/rules/index.js';
import { scoreAxes } from '../src/audit/scoring.js';
import type { AuditFacts } from '../src/audit/types.js';

import { makeBaseFacts } from './helpers/base-facts.js';

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

function facts(): AuditFacts {
  return makeBaseFacts({
    images: { total: 20, withAlt: 5, emptyAlt: 0, lazyLoaded: 20, withDimensions: 20 },
  });
}

function deps(f: AuditFacts, ai?: PipelineDeps['aiReadiness']): PipelineDeps {
  return {
    collect: () => Promise.resolve(structuredClone(f)),
    applyRules: (x) => applyAllRules(x),
    scoreAxes: (_x, findings) => scoreAxes(findings),
    deriveSectorHints: () => ({ detected: 'générique', confidence: 0.1 }),
    pickInternalSample: () => [],
    pickHomeHtmlExcerpt: () => '',
    llmConfig: { provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'missing-key' },
    skipLlm: true,
    logger: silent,
    ...(ai ? { aiReadiness: ai } : {}),
  };
}

function aiResult(score: number): AiReadinessResult {
  return {
    version: 1,
    status: 'completed',
    scanned_at: '2026-11-06T10:00:00.000Z',
    score,
    level: 1,
    level_name: 'Présence de base',
    max_level: 3,
    site_type: 'vitrine',
    site_type_auto: true,
    site_type_signals: [],
    included_in_global_score: false,
    error: null,
    checks: [],
  };
}

const strip = (r: Awaited<ReturnType<typeof runFullAudit>>) => ({
  ...r.report,
  facts: undefined,
  scannedAt: undefined,
});

describe('Préparation IA in the full-audit pipeline', () => {
  it('module off: the report is exactly the 8-axis one (regression)', async () => {
    const f = facts();
    const off = await runFullAudit(f.url, deps(f));
    expect('aiReadiness' in off.report).toBe(false);
    expect(off.report.globalScore).toBe(computeGlobalScore(off.report.scores).globalScore);
    const again = await runFullAudit(f.url, deps(f));
    expect(strip(again)).toEqual(strip(off));
    // The LLM input never carries the AI readiness data.
    expect(JSON.stringify(off.llmInput)).not.toMatch(/ai_?readiness/i);
  });

  it('module on, not in the global score: same global score, result attached', async () => {
    const f = facts();
    const off = await runFullAudit(f.url, deps(f));
    const run = vi.fn(() => Promise.resolve(aiResult(20)));
    const on = await runFullAudit(f.url, deps(f, { run, includeInGlobalScore: false }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(on.report.globalScore).toBe(off.report.globalScore);
    expect(on.report.globalBand).toBe(off.report.globalBand);
    expect(on.report.aiReadiness).toMatchObject({ score: 20, included_in_global_score: false });
    // Everything else is unchanged.
    expect({ ...strip(on), aiReadiness: undefined }).toEqual({
      ...strip(off),
      aiReadiness: undefined,
    });
  });

  it('install setting on: the AI score (/10) joins the weighted mean', async () => {
    const f = facts();
    const off = await runFullAudit(f.url, deps(f));
    const on = await runFullAudit(
      f.url,
      deps(f, { run: () => Promise.resolve(aiResult(0)), includeInGlobalScore: true }),
    );
    const expected = computeGlobalScore(off.report.scores, [
      { score: 0, weight: AI_READINESS_GLOBAL_WEIGHT },
    ]);
    expect(on.report.globalScore).toBe(expected.globalScore);
    expect(off.report.globalScore).not.toBeNull();
    if (off.report.globalScore === null) throw new Error('Expected evaluated axes');
    expect(on.report.globalScore).toBeLessThan(off.report.globalScore);
    expect(on.report.aiReadiness?.included_in_global_score).toBe(true);
  });

  it('a failed AI run is never folded into the global score', async () => {
    const f = facts();
    const off = await runFullAudit(f.url, deps(f));
    const on = await runFullAudit(
      f.url,
      deps(f, {
        run: () => Promise.resolve(failedStoredResult('auto', 'site_unreachable')),
        includeInGlobalScore: true,
      }),
    );
    expect(on.report.globalScore).toBe(off.report.globalScore);
    expect(on.report.aiReadiness).toMatchObject({
      status: 'failed',
      score: null,
      included_in_global_score: false,
    });
  });

  it('a throwing AI run never breaks the audit', async () => {
    const f = facts();
    const on = await runFullAudit(
      f.url,
      deps(f, { run: () => Promise.reject(new Error('boom')), includeInGlobalScore: true }),
    );
    expect(on.report.aiReadiness?.status).toBe('failed');
    expect(on.report.findings.length).toBeGreaterThan(0);
  });
});
