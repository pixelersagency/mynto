import { DEFAULT_AUDIT_MODULES, type AuditModules } from '@mynto/shared';
import { describe, expect, it } from 'vitest';

import { collectorPlan } from '../src/audit/modules-plan.js';
import { computeGlobalScore } from '../src/audit/narrative.js';
import { runFullAudit, type PipelineDeps } from '../src/audit/pipeline.js';
import { applyAllRules } from '../src/audit/rules/index.js';
import { SCORED_AXES, scoreAxes } from '../src/audit/scoring.js';
import type { AuditAxis, AuditFacts } from '../src/audit/types.js';

import { makeBaseFacts } from './helpers/base-facts.js';

/** Facts that trigger findings on several axes. */
function noisyFacts(): AuditFacts {
  const base = makeBaseFacts();
  return makeBaseFacts({
    lighthouse: { ...base.lighthouse, fetched: true, performance: 0.9 },
    axe: { ...base.axe, fetched: true },
    vision: { ...base.vision, fetched: true },
    sitemap: {
      triedLocations: [],
      found: false,
      foundAt: null,
      declaredInRobots: false,
      urlsCount: 0,
      sampleUrls: [],
    },
    images: { total: 20, withAlt: 5, emptyAlt: 0, lazyLoaded: 20, withDimensions: 20 },
  });
}

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

function deps(facts: AuditFacts, axes?: readonly AuditAxis[]): PipelineDeps {
  return {
    collect: () => Promise.resolve(structuredClone(facts)),
    applyRules: (f) => applyAllRules(f, axes),
    scoreAxes: (_f, findings) => scoreAxes(findings, axes),
    deriveSectorHints: () => ({ detected: 'générique', confidence: 0.1 }),
    pickInternalSample: () => [],
    pickHomeHtmlExcerpt: () => '',
    llmConfig: { provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: 'missing-key' },
    skipLlm: true,
    logger: silent,
  };
}

describe('audit modules: axes', () => {
  it('all axes enabled = exactly the historical behaviour (regression)', async () => {
    const facts = noisyFacts();
    const legacy = await runFullAudit(facts.url, deps(facts));
    const allOn = await runFullAudit(facts.url, deps(facts, DEFAULT_AUDIT_MODULES.axes));
    const strip = (r: typeof legacy) => ({
      ...r.report,
      facts: undefined,
      scannedAt: undefined,
    });
    expect(strip(allOn)).toEqual(strip(legacy));
    expect(allOn.report.scores.map((s) => s.axis)).toEqual([...SCORED_AXES]);
    // Deterministic across runs.
    const again = await runFullAudit(facts.url, deps(facts, DEFAULT_AUDIT_MODULES.axes));
    expect(strip(again)).toEqual(strip(allOn));
  });

  it('disabled axes produce no finding, no score, and the global score only covers enabled axes', async () => {
    const facts = noisyFacts();
    const axes: AuditAxis[] = ['seo_technique', 'performance'];
    const res = await runFullAudit(facts.url, deps(facts, axes));
    expect(res.report.scores.map((s) => s.axis)).toEqual(axes);
    expect(res.report.findings.every((f) => axes.includes(f.axis))).toBe(true);
    expect(res.report.findings.length).toBeGreaterThan(0);

    const full = await runFullAudit(facts.url, deps(facts));
    const subset = full.report.scores.filter((s) => axes.includes(s.axis));
    expect(res.report.globalScore).toBe(computeGlobalScore(subset).globalScore);
    // A disabled axis is never scored as 0.
    expect(res.report.scores.find((s) => s.axis === 'accessibilite')).toBeUndefined();
  });

  it('scoreAxes keeps the canonical order whatever the input order', () => {
    const scores = scoreAxes([], ['ui', 'seo_technique']);
    expect(scores.map((s) => s.axis)).toEqual(['seo_technique', 'ui']);
    expect(scores.every((s) => s.score === 10)).toBe(true);
  });
});

describe('collectorPlan', () => {
  const m = (patch: Partial<AuditModules>): AuditModules => ({
    ...DEFAULT_AUDIT_MODULES,
    ...patch,
  });

  it('runs everything when every module is on', () => {
    expect(collectorPlan(DEFAULT_AUDIT_MODULES)).toEqual({
      lighthouse: true,
      axe: true,
      vision: true,
      hero: true,
      designMeasurements: true,
    });
  });

  it('skips collectors whose module is off or whose axes are all disabled', () => {
    expect(collectorPlan(m({ lighthouse: false, vision: false, hero: false }))).toEqual({
      lighthouse: false,
      axe: true,
      vision: false,
      hero: false,
      designMeasurements: true,
    });
    expect(collectorPlan(m({ axes: ['seo_technique', 'seo_contenu', 'conformite'] }))).toEqual({
      lighthouse: false,
      axe: false,
      vision: false,
      hero: true,
      designMeasurements: false,
    });
    expect(collectorPlan(m({ axes: ['performance'] })).lighthouse).toBe(true);
    expect(collectorPlan(m({ axes: ['ux'], vision: false })).designMeasurements).toBe(true);
    expect(collectorPlan(m({ axes: ['conversion'] })).designMeasurements).toBe(false);
    expect(collectorPlan(m({ axes: ['conversion'] })).vision).toBe(true);
  });
});
