import { describe, expect, it } from 'vitest';

import { computeGlobalScore } from '../src/audit/narrative.js';
import { axisScoresToMap } from '../src/audit/persist.js';
import { runFullAudit, type PipelineDeps } from '../src/audit/pipeline.js';
import { renderMarkdownReport } from '../src/audit/render/markdown.js';
import { applyAllRules } from '../src/audit/rules/index.js';
import { scoreAxes } from '../src/audit/scoring.js';
import type { AuditAxis, AuditFacts } from '../src/audit/types.js';

import { makeBaseFacts } from './helpers/base-facts.js';

function deps(facts: AuditFacts, axes?: AuditAxis[]): PipelineDeps {
  return {
    collect: () => Promise.resolve(facts),
    applyRules: (f) => applyAllRules(f, axes),
    scoreAxes: (_f, findings) => scoreAxes(findings, axes),
    deriveSectorHints: () => ({}),
    pickInternalSample: () => [],
    pickHomeHtmlExcerpt: () => '',
    skipLlm: true,
    llmConfig: { provider: 'anthropic', model: 'unused', apiKey: '' },
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
  };
}

describe('collector coverage through pipeline and persistence', () => {
  it('missing collectors never certify a perfect score; deterministic findings survive', async () => {
    const base = makeBaseFacts();
    const facts = makeBaseFacts({
      ux: { ...base.ux, hasMobileViewport: false },
      ui: { ...base.ui, fontFamiliesCount: 7 },
    });
    const { report } = await runFullAudit(facts.url, deps(facts));
    expect(report.scores.map((s) => s.axis)).toEqual([
      'seo_technique',
      'seo_contenu',
      'conformite',
    ]);
    expect(report.findings.some((f) => f.ruleCode === 'ux.viewport.missing')).toBe(true);
    expect(report.findings.some((f) => f.ruleCode === 'ui.fonts.too_many')).toBe(true);
    expect(axisScoresToMap(report.scores)).not.toHaveProperty('performance');
    expect(report.globalScore).toBe(computeGlobalScore(report.scores).globalScore);
    expect(renderMarkdownReport(report)).toContain('Performance - Non évalué');
    expect(report.execSummary).toContain('/100');
  });

  it('no evaluated axis gives null global score and band, never zero or 100', async () => {
    const facts = makeBaseFacts();
    const { report } = await runFullAudit(
      facts.url,
      deps(facts, ['performance', 'accessibilite', 'ui', 'ux', 'conversion']),
    );
    expect(report.scores).toEqual([]);
    expect(report.globalScore).toBeNull();
    expect(report.globalBand).toBeNull();
    expect(report.execSummary).toContain('Non évalué');
    expect(renderMarkdownReport(report)).toContain('**Score global estimé** : Non évalué');
  });

  it('a real zero is evaluated and participates in the global score', async () => {
    const base = makeBaseFacts();
    const facts = makeBaseFacts({
      lighthouse: { ...base.lighthouse, fetched: true, performance: 0 },
      axe: { ...base.axe, fetched: true },
      vision: { ...base.vision, fetched: true },
    });
    const { report } = await runFullAudit(facts.url, deps(facts));
    expect(report.scores).toHaveLength(8);
    expect(report.scores.find((s) => s.axis === 'performance')?.score).toBeLessThan(10);
    expect(report.scores.find((s) => s.axis === 'ui')?.score).toBe(10);
  });

  it('fetched Lighthouse with no performance score remains unevaluated', async () => {
    const base = makeBaseFacts();
    const facts = makeBaseFacts({ lighthouse: { ...base.lighthouse, fetched: true } });
    const { report } = await runFullAudit(facts.url, deps(facts, ['performance']));
    expect(report.globalScore).toBeNull();
    expect(report.scores).toEqual([]);
  });
});

it('advisory deterministic observations do not reduce any score', () => {
  const base = makeBaseFacts();
  const facts = makeBaseFacts({ ui: { ...base.ui, fontFamiliesCount: 7 } });
  const findings = applyAllRules(facts, ['ui']);
  expect(findings.some((f) => f.advisory === true)).toBe(true);
  expect(scoreAxes(findings, ['ui'])[0]?.score).toBe(10);
});
