import { describe, expect, it } from 'vitest';

import { decideRemediation } from '../src/audit/remediation/arbitrage.js';
import { estimateRemediation } from '../src/audit/remediation/chiffrage.js';
import { applyAllRules } from '../src/audit/rules/index.js';
import { scoreAxes } from '../src/audit/scoring.js';
import type { AuditFacts, AxisScore, Finding } from '../src/audit/types.js';

import { makeBaseFacts } from './helpers/base-facts.js';

function findingsAndScores(facts: AuditFacts): { findings: Finding[]; scores: AxisScore[] } {
  const findings = applyAllRules(facts);
  return { findings, scores: scoreAxes(findings) };
}

describe('estimateRemediation (chiffrage)', () => {
  it('costs deterministic findings and excludes qualitative ones', () => {
    const facts = makeBaseFacts({
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
    const { findings } = findingsAndScores(facts);
    const est = estimateRemediation(findings, facts, { dailyRateEur: 500, billableHoursPerDay: 7 });

    // sitemap missing (30) is costed.
    expect(est.items.some((i) => i.ruleCode === 'seo.sitemap.missing')).toBe(true);
    // missing alt counts 15 images: base 15 + 4*(15-1) = 71 minutes.
    const alt = est.items.find((i) => i.ruleCode === 'a11y.images.missing_alt');
    expect(alt?.occurrences).toBe(15);
    expect(alt?.minutes).toBe(15 + 4 * 14);
    expect(est.totalMinutes).toBeGreaterThan(0);
    expect(est.amountEurHigh).toBeGreaterThan(est.amountEurLow);
    expect(est.disclaimer).toMatch(/indicative/i);
  });

  it('never costs qualitative grid findings', () => {
    const facts = makeBaseFacts({
      vision: {
        ...makeBaseFacts().vision,
        fetched: true,
        model: 'gemini-2.5-flash',
        uiGrid: [
          {
            key: 'hierarchie_visuelle',
            rating: 'probleme',
            justification: 'titre recouvre le sous-titre',
            viewport: 'mobile',
            region: 'hero',
          },
          {
            key: 'coherence_couleurs',
            rating: 'probleme',
            justification: 'états sélectionnés et non sélectionnés indiscernables',
            viewport: 'desktop',
            region: 'navigation',
          },
        ],
      },
    });
    const { findings } = findingsAndScores(facts);
    const gridFindings = findings.filter((f) => f.kind === 'qualitative');
    expect(gridFindings.length).toBeGreaterThanOrEqual(2);

    const est = estimateRemediation(findings, facts);
    expect(est.qualitativeExcludedCount).toBeGreaterThanOrEqual(2);
    // No qualitative finding id appears in the costed items.
    const costedIds = new Set(est.items.map((i) => i.findingId));
    for (const f of gridFindings) {
      expect(costedIds.has(f.id)).toBe(false);
    }
  });

  it('does not cost a structural ui.tech.outdated finding', () => {
    const facts = makeBaseFacts({
      techAge: { ...makeBaseFacts().techAge, isDated: true, reasons: ['jQuery 1.x'] },
    });
    const { findings } = findingsAndScores(facts);
    const tech = findings.find((f) => f.ruleCode === 'ui.tech.outdated');
    expect(tech).toBeDefined();
    const est = estimateRemediation(findings, facts);
    expect(est.items.some((item) => item.findingId === tech?.id)).toBe(false);
    expect(est.uncostedFindingIds).toContain(tech?.id);
  });
});

describe('decideRemediation (arbitrage)', () => {
  it('keeps both doors open on a clean site', () => {
    const facts = makeBaseFacts();
    const { scores } = findingsAndScores(facts);
    const v = decideRemediation(facts, scores);
    expect(v.mode).toBe('correction_or_redesign');
    expect(v.showQuickFixButton).toBe(true);
    expect(v.redesignReasons).toHaveLength(0);
  });

  it('forces redesign on a closed CMS (Wix)', () => {
    const facts = makeBaseFacts({ stack: { stack: 'wix', confidence: 0.95, evidence: [] } });
    const { scores } = findingsAndScores(facts);
    const v = decideRemediation(facts, scores);
    expect(v.closedCms).toBe(true);
    expect(v.mode).toBe('redesign_only');
    expect(v.showQuickFixButton).toBe(false);
    expect(v.redesignReasons.join(' ')).toMatch(/Wix/);
  });

  it('forces redesign when dated tech corroborates the modernité grid cell', () => {
    const facts = makeBaseFacts({
      techAge: { ...makeBaseFacts().techAge, isDated: true, reasons: ['tables de layout'] },
      vision: {
        ...makeBaseFacts().vision,
        fetched: true,
        uiGrid: [
          { key: 'impression_modernite', rating: 'probleme', justification: 'mise en page 2010' },
        ],
      },
    });
    const { scores } = findingsAndScores(facts);
    const v = decideRemediation(facts, scores);
    expect(v.mode).toBe('redesign_only');
    expect(v.datedTech).toBe(true);
  });

  it('forces redesign when 3+ axes are in the red', () => {
    const redScores: AxisScore[] = [
      { axis: 'seo_technique', score: 2, band: 'critical', weight: 1.2 },
      { axis: 'performance', score: 1, band: 'critical', weight: 1 },
      { axis: 'conversion', score: 3, band: 'poor', weight: 1.2 },
      { axis: 'ui', score: 8, band: 'good', weight: 0.6 },
      { axis: 'ux', score: 8, band: 'good', weight: 0.8 },
    ];
    const v = decideRemediation(makeBaseFacts(), redScores);
    expect(v.mode).toBe('redesign_only');
    expect(v.redesignReasons.join(' ')).toMatch(/rouge/);
  });
});
