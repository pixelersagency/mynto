import type { AuditFacts, Finding } from '../types.js';

import { makeFinding, type RuleDefinition } from './types.js';

const TTFB_SLOW: RuleDefinition = {
  code: 'perf.ttfb.slow',
  axis: 'performance',
  defaultSeverity: 'P1',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    const t = facts.http.ttfbMs;
    if (t === null || t < 800) return null;
    return makeFinding(TTFB_SLOW, {
      title: `TTFB élevé (${t.toString()} ms)`,
      evidence: { ttfbMs: t },
    });
  },
};

const HEAVY_HTML: RuleDefinition = {
  code: 'perf.html.heavy',
  axis: 'performance',
  defaultSeverity: 'P2',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (facts.http.htmlBytes < 250_000) return null;
    return makeFinding(HEAVY_HTML, {
      // Decimal KB so the displayed figure matches the 250 KB threshold
      // (1024-based "KiB" made a 244.6 KiB page read as "245 KB" yet trip a
      // "250 KB" rule).
      title: `Page HTML très lourde (${Math.round(facts.http.htmlBytes / 1000).toString()} KB)`,
      evidence: { bytes: facts.http.htmlBytes },
    });
  },
};

const IMAGES_NOT_LAZY: RuleDefinition = {
  code: 'perf.images.not_lazy',
  axis: 'performance',
  defaultSeverity: 'P2',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    const { total, lazyLoaded } = facts.images;
    if (total < 10) return null;
    if (lazyLoaded >= total * 0.5) return null;
    return makeFinding(IMAGES_NOT_LAZY, {
      title: `Lazy-loading appliqué à seulement ${lazyLoaded.toString()} image(s) sur ${total.toString()}`,
      evidence: { total, lazyLoaded },
    });
  },
};

const IMAGES_MISSING_DIMENSIONS: RuleDefinition = {
  code: 'perf.images.missing_dimensions',
  axis: 'performance',
  defaultSeverity: 'P2',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    const { total, withDimensions } = facts.images;
    if (total < 5) return null;
    if (withDimensions >= total * 0.7) return null;
    return makeFinding(IMAGES_MISSING_DIMENSIONS, {
      title: `Images sans width/height (risque CLS) : ${(total - withDimensions).toString()}/${total.toString()}`,
      evidence: { total, withDimensions },
    });
  },
};

const LIGHTHOUSE_PERF_LOW: RuleDefinition = {
  code: 'perf.lighthouse.low',
  axis: 'performance',
  defaultSeverity: 'P1',
  defaultEffort: 'important',
  evaluate: ({ facts }) => {
    if (!facts.lighthouse.fetched) return null;
    const score = facts.lighthouse.performance;
    if (score === null || score >= 0.7) return null;
    return makeFinding(LIGHTHOUSE_PERF_LOW, {
      title: `Score Lighthouse performance bas (${Math.round(score * 100).toString()}/100)`,
      evidence: { score, lcpMs: facts.lighthouse.lcpMs, cls: facts.lighthouse.clsScore },
    });
  },
};

const LCP_SLOW: RuleDefinition = {
  code: 'perf.lcp.slow',
  axis: 'performance',
  defaultSeverity: 'P1',
  defaultEffort: 'important',
  evaluate: ({ facts }) => {
    if (!facts.lighthouse.fetched) return null;
    const lcp = facts.lighthouse.lcpMs;
    if (lcp === null || lcp < 2500) return null;
    return makeFinding(LCP_SLOW, {
      title: `LCP lent (${Math.round(lcp).toString()} ms, seuil Google = 2500 ms)`,
      evidence: { lcpMs: lcp },
    });
  },
};

const CLS_HIGH: RuleDefinition = {
  code: 'perf.cls.high',
  axis: 'performance',
  defaultSeverity: 'P1',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (!facts.lighthouse.fetched) return null;
    const cls = facts.lighthouse.clsScore;
    if (cls === null || cls < 0.1) return null;
    return makeFinding(CLS_HIGH, {
      title: `CLS élevé (${cls.toFixed(3)}, seuil Google = 0.1)`,
      evidence: { cls },
    });
  },
};

const TBT_HIGH: RuleDefinition = {
  code: 'perf.tbt.high',
  axis: 'performance',
  defaultSeverity: 'P2',
  defaultEffort: 'important',
  evaluate: ({ facts }) => {
    if (!facts.lighthouse.fetched) return null;
    const tbt = facts.lighthouse.tbtMs;
    if (tbt === null || tbt < 300) return null;
    return makeFinding(TBT_HIGH, {
      title: `Total Blocking Time élevé (${Math.round(tbt).toString()} ms)`,
      evidence: { tbtMs: tbt },
    });
  },
};

const BYTE_WEIGHT_HEAVY: RuleDefinition = {
  code: 'perf.byte_weight.heavy',
  axis: 'performance',
  defaultSeverity: 'P2',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (!facts.lighthouse.fetched) return null;
    const bytes = facts.lighthouse.totalByteWeight;
    if (bytes === null || bytes < 3_000_000) return null;
    return makeFinding(BYTE_WEIGHT_HEAVY, {
      title: `Page très lourde (${Math.round(bytes / 1024).toString()} KB chargés)`,
      evidence: { bytes },
    });
  },
};

export const PERFORMANCE_RULES: RuleDefinition[] = [
  TTFB_SLOW,
  HEAVY_HTML,
  IMAGES_NOT_LAZY,
  IMAGES_MISSING_DIMENSIONS,
  LIGHTHOUSE_PERF_LOW,
  LCP_SLOW,
  CLS_HIGH,
  TBT_HIGH,
  BYTE_WEIGHT_HEAVY,
];

export function applyPerformanceRules(ctx: { facts: AuditFacts; origin: string }): Finding[] {
  const out: Finding[] = [];
  for (const rule of PERFORMANCE_RULES) {
    const res = rule.evaluate(ctx);
    if (!res) continue;
    if (Array.isArray(res)) out.push(...res);
    else out.push(res);
  }
  return out;
}
