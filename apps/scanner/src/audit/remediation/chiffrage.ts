import type { AuditFacts, Finding } from '../types.js';

/**
 * Time-to-fix chiffrage — a price anchor adapted to
 * WordPress dev.
 *
 * Each DETERMINISTIC finding carries an estimated fix time (base minutes +
 * per-occurrence minutes weighted by how many times the error appears).
 * The total rolls up to a number of days, which - multiplied by the
 * agency daily rate - lets the prospect derive the price himself. The
 * number feels mechanical, not negotiated.
 *
 * HARD RULES :
 *   - Qualitative findings are NEVER costed (they justify a redesign, not a
 *     quick fix). Filtered out up front by `kind`.
 *   - Structural deterministic findings (dated stack, fake one-page,
 *     aggregate Lighthouse scores) have NO cost entry on purpose : they
 *     point to a redesign too, so costing them as "quick fixes" would be a
 *     lie. They surface in `uncostedFindingIds`.
 *   - The result is presented as an ESTIMATION INDICATIVE, never a firm
 *     quote (the disclaimer ships with the estimate). WordPress dev is less
 *     predictable than SEO : a fix can hide a template rebuild.
 */

interface CostEntry {
  baseMinutes: number;
  /** Extra minutes per occurrence beyond the first. 0 for one-shot fixes. */
  perOccurrenceMinutes: number;
  /** Derives the occurrence count from facts (e.g. number of images
   * missing alt). Defaults to the finding's own `occurrences`. */
  occurrences?: (finding: Finding, facts: AuditFacts) => number;
}

/**
 * Per-rule time table. Only deterministic, genuinely-standardisable fixes
 * appear here. Minutes reflect a competent WP integrator, not a junior.
 * Absent rule code = not costed (qualitative or structural).
 */
const RULE_COST: Record<string, CostEntry> = {
  // --- SEO technique (template / config edits) --------------------------
  'seo.sitemap.missing': { baseMinutes: 30, perOccurrenceMinutes: 0 },
  'seo.sitemap.not_declared_in_robots': { baseMinutes: 10, perOccurrenceMinutes: 0 },
  'seo.title.missing': { baseMinutes: 20, perOccurrenceMinutes: 0 },
  'seo.title.too_long': { baseMinutes: 15, perOccurrenceMinutes: 0 },
  'seo.meta_description.missing': { baseMinutes: 20, perOccurrenceMinutes: 0 },
  'seo.meta_description.too_long': { baseMinutes: 15, perOccurrenceMinutes: 0 },
  'seo.canonical.points_to_home': { baseMinutes: 25, perOccurrenceMinutes: 0 },
  'seo.h1.missing_or_multiple': { baseMinutes: 25, perOccurrenceMinutes: 0 },
  'seo.headings.hierarchy_broken': { baseMinutes: 30, perOccurrenceMinutes: 0 },
  'seo.hreflang.missing': { baseMinutes: 45, perOccurrenceMinutes: 0 },
  'seo.https.missing': { baseMinutes: 60, perOccurrenceMinutes: 0 },
  'seo.json_ld.absent': { baseMinutes: 45, perOccurrenceMinutes: 0 },
  'seo.og_image.missing': { baseMinutes: 20, perOccurrenceMinutes: 0 },
  'seo.twitter_card.summary_small': { baseMinutes: 15, perOccurrenceMinutes: 0 },
  'seo.robots.blocks_ai_bots': { baseMinutes: 10, perOccurrenceMinutes: 0 },
  'seo.robots.disallow_all': { baseMinutes: 15, perOccurrenceMinutes: 0 },

  // --- Accessibilité (per-occurrence on images / axe nodes) -------------
  'a11y.html_lang.missing': { baseMinutes: 5, perOccurrenceMinutes: 0 },
  'a11y.images.missing_alt': {
    baseMinutes: 15,
    perOccurrenceMinutes: 4,
    occurrences: (_f, facts) => Math.max(1, facts.images.total - facts.images.withAlt),
  },
  'a11y.skip_link.missing': { baseMinutes: 20, perOccurrenceMinutes: 0 },
  'a11y.viewport.blocks_zoom': { baseMinutes: 10, perOccurrenceMinutes: 0 },
  'a11y.axe.critical': {
    baseMinutes: 30,
    perOccurrenceMinutes: 15,
    occurrences: (_f, facts) => axeNodeCount(facts, 'critical'),
  },
  'a11y.axe.serious': {
    baseMinutes: 20,
    perOccurrenceMinutes: 10,
    occurrences: (_f, facts) => axeNodeCount(facts, 'serious'),
  },

  // --- Conformité --------------------------------------------------------
  'conformite.mentions_legales.missing': { baseMinutes: 60, perOccurrenceMinutes: 0 },
  'conformite.privacy.missing': { baseMinutes: 90, perOccurrenceMinutes: 0 },
  'conformite.dpo.not_mentioned': { baseMinutes: 20, perOccurrenceMinutes: 0 },
  'conformite.trackers.without_banner': { baseMinutes: 120, perOccurrenceMinutes: 0 },

  // --- Conversion (deterministic structural CTAs / pages) ---------------
  'conversion.pricing.anchor_only': { baseMinutes: 60, perOccurrenceMinutes: 0 },
  'conversion.cta.not_above_fold': { baseMinutes: 30, perOccurrenceMinutes: 0 },
  'conversion.contact.thin': { baseMinutes: 45, perOccurrenceMinutes: 0 },

  // --- Performance (cache / asset work) ---------------------------------
  'perf.ttfb.slow': { baseMinutes: 120, perOccurrenceMinutes: 0 },
  'perf.html.heavy': { baseMinutes: 90, perOccurrenceMinutes: 0 },
  'perf.byte_weight.heavy': { baseMinutes: 90, perOccurrenceMinutes: 0 },
  'perf.images.not_lazy': {
    baseMinutes: 20,
    perOccurrenceMinutes: 2,
    occurrences: (_f, facts) => Math.max(1, facts.images.total - facts.images.lazyLoaded),
  },
  'perf.images.missing_dimensions': {
    baseMinutes: 15,
    perOccurrenceMinutes: 2,
    occurrences: (_f, facts) => Math.max(1, facts.images.total - facts.images.withDimensions),
  },
  'perf.lcp.slow': { baseMinutes: 120, perOccurrenceMinutes: 0 },
  'perf.cls.high': { baseMinutes: 90, perOccurrenceMinutes: 0 },
  'perf.tbt.high': { baseMinutes: 120, perOccurrenceMinutes: 0 },

  // --- SEO contenu (copywriting / setup) --------------------------------
  'seo_contenu.blog.absent': { baseMinutes: 120, perOccurrenceMinutes: 0 },
  'seo_contenu.blog.external_jus_lost': { baseMinutes: 60, perOccurrenceMinutes: 0 },
  'seo_contenu.home.thin': { baseMinutes: 90, perOccurrenceMinutes: 0 },
  'seo_contenu.readability.hard': { baseMinutes: 60, perOccurrenceMinutes: 0 },

  // --- UI (deterministic only) ------------------------------------------
  'ui.fonts.too_many': { baseMinutes: 30, perOccurrenceMinutes: 0 },
  'ui.inline_styles.heavy': { baseMinutes: 60, perOccurrenceMinutes: 0 },

  // --- UX (deterministic only) ------------------------------------------
  'ux.viewport.missing': { baseMinutes: 10, perOccurrenceMinutes: 0 },
  'ux.nav.empty': { baseMinutes: 40, perOccurrenceMinutes: 0 },
};

function axeNodeCount(facts: AuditFacts, impact: 'critical' | 'serious'): number {
  return Math.max(
    1,
    facts.axe.violations
      .filter((v) => v.impact === impact)
      .reduce((acc, v) => acc + Math.max(1, v.nodes), 0),
  );
}

export interface CostItem {
  findingId: string;
  ruleCode: string;
  title: string;
  occurrences: number;
  minutes: number;
}

export interface CostEstimate {
  /** Sum of costed minutes across deterministic findings. */
  totalMinutes: number;
  /** Rounded to 0.1 day at the configured billable hours/day. */
  totalDays: number;
  dailyRateEur: number;
  billableHoursPerDay: number;
  /** Indicative range (±20%) so the figure reads as an estimate, not a quote. */
  amountEurLow: number;
  amountEurHigh: number;
  items: CostItem[];
  /** Deterministic findings with no cost entry (structural → redesign). */
  uncostedFindingIds: string[];
  /** Number of qualitative findings excluded by design. */
  qualitativeExcludedCount: number;
  disclaimer: string;
}

export interface ChiffrageOptions {
  dailyRateEur?: number;
  billableHoursPerDay?: number;
}

const DISCLAIMER =
  'Estimation indicative du temps de correction, pas un devis ferme. ' +
  'Le développement WordPress est moins prévisible que le SEO : une correction peut révéler un travail plus profond sur le template. Le chiffre final est confirmé après un échange.';

export function estimateRemediation(
  findings: Finding[],
  facts: AuditFacts,
  opts: ChiffrageOptions = {},
): CostEstimate {
  const dailyRateEur = opts.dailyRateEur ?? 500;
  const billableHoursPerDay = opts.billableHoursPerDay ?? 7;

  const items: CostItem[] = [];
  const uncostedFindingIds: string[] = [];
  let qualitativeExcludedCount = 0;

  for (const f of findings) {
    if (f.kind === 'qualitative') {
      qualitativeExcludedCount += 1;
      continue;
    }
    if ('advisory' in f && f.advisory === true) {
      uncostedFindingIds.push(f.id);
      continue;
    }
    const entry = RULE_COST[f.ruleCode];
    if (!entry) {
      uncostedFindingIds.push(f.id);
      continue;
    }
    const occurrences = Math.max(
      1,
      Math.floor(entry.occurrences ? entry.occurrences(f, facts) : f.occurrences),
    );
    const extra = entry.perOccurrenceMinutes * Math.max(0, occurrences - 1);
    const minutes = entry.baseMinutes + extra;
    items.push({
      findingId: f.id,
      ruleCode: f.ruleCode,
      title: f.title,
      occurrences,
      minutes,
    });
  }

  const totalMinutes = items.reduce((acc, it) => acc + it.minutes, 0);
  const rawDays = totalMinutes / 60 / billableHoursPerDay;
  const totalDays = Math.round(rawDays * 10) / 10;
  const baseAmount = rawDays * dailyRateEur;
  const amountEurLow = Math.round((baseAmount * 0.8) / 10) * 10;
  const amountEurHigh = Math.round((baseAmount * 1.2) / 10) * 10;

  return {
    totalMinutes,
    totalDays,
    dailyRateEur,
    billableHoursPerDay,
    amountEurLow,
    amountEurHigh,
    items,
    uncostedFindingIds,
    qualitativeExcludedCount,
    disclaimer: DISCLAIMER,
  };
}
