/**
 * Internal types for the full-audit pipeline.
 *
 * Shape contract: every collector returns a slice of `AuditFacts`, every rule
 * reads from `AuditFacts` and emits `Finding[]`. The LLM never invents
 * findings — it reformulates the deterministic findings into a consultant
 * narrative.
 */

import type { AiReadinessResult } from '@mynto/shared';

import type { DesignMeasurements } from './collectors/design-measurements.js';
import type { GridCriterionEntry } from './grid.js';
import type { RemediationVerdict } from './remediation/arbitrage.js';
import type { CostEstimate } from './remediation/chiffrage.js';

export type AuditAxis =
  | 'ux'
  | 'ui'
  | 'seo_technique'
  | 'seo_contenu'
  | 'performance'
  | 'accessibilite'
  | 'conformite'
  | 'conversion';

export type Severity = 'P0' | 'P1' | 'P2' | 'P3';

export type Effort = 'quick_win' | 'standard' | 'important';

/**
 * Nature of a finding, central to the scoring model.
 *
 *  - `deterministic` : the verdict is read straight from the DOM or a
 *    measurement (count, byte size, threshold, axe/Lighthouse engine
 *    output). These findings carry the immediate credibility AND drive
 *    the time-to-fix chiffrage. The LLM only narrates them.
 *  - `qualitative` : the verdict needs judgment (UI/UX/design). Presented
 *    as expert analysis, NEVER costed in days, and used to justify a
 *    redesign rather than a quick fix. The closed-grid vision rubric is
 *    what bounds this judgment.
 */
export type FindingKind = 'deterministic' | 'qualitative';

/** Stack / CMS detected for the audited site. Drives resilient path lookup. */
export type DetectedStack =
  | 'wordpress'
  | 'wordpress_bricks'
  | 'wordpress_elementor'
  | 'wordpress_divi'
  | 'shopify'
  | 'wix'
  | 'webflow'
  | 'framer'
  | 'squarespace'
  | 'simplebo'
  | 'nextjs'
  | 'nuxt'
  | 'gatsby'
  | 'astro'
  | 'react_generic'
  | 'vue_generic'
  | 'static_html'
  | 'drupal'
  | 'joomla'
  | 'prestashop'
  | 'magento'
  | 'unknown';

export interface StackSignal {
  stack: DetectedStack;
  confidence: number;
  evidence: string[];
}

export interface HttpFacts {
  finalUrl: string;
  status: number;
  redirectChain: string[];
  responseHeaders: Record<string, string>;
  ttfbMs: number | null;
  htmlBytes: number;
  isHttps: boolean;
  hasHsts: boolean;
  hasCsp: boolean;
}

export interface MetaFacts {
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  htmlLang: string | null;
  charset: string | null;
  viewport: string | null;
  themeColor: string | null;
  robotsMeta: string | null;
  hreflangs: { lang: string; href: string }[];
  og: Record<string, string>;
  twitter: Record<string, string>;
  jsonLd: unknown[];
  generator: string | null;
}

export interface ImageFacts {
  total: number;
  withAlt: number;
  emptyAlt: number;
  lazyLoaded: number;
  withDimensions: number;
}

export interface HeadingFacts {
  h1Count: number;
  h1Texts: string[];
  hierarchyBroken: boolean;
  headings: { level: number; text: string }[];
}

export interface SitemapFacts {
  /** All locations tried, with status code (200 / 404 / network) and bytes. */
  triedLocations: { url: string; status: number | 'error' | 'timeout' }[];
  found: boolean;
  foundAt: string | null;
  declaredInRobots: boolean;
  urlsCount: number;
  sampleUrls: string[];
}

export interface RobotsFacts {
  present: boolean;
  url: string;
  content: string | null;
  blocksAiBots: string[];
  hasSitemapDirective: boolean;
  hasDisallowAll: boolean;
}

export interface LegalFacts {
  mentionsLegalesUrl: string | null;
  mentionsLegalesStatus: number | null;
  /** External (off-domain) link to a legal-notices page, set only when no
   * same-origin page was found. The page exists but is not hosted on the site. */
  mentionsLegalesExternalUrl: string | null;
  privacyUrl: string | null;
  privacyStatus: number | null;
  /** External (off-domain) link to a privacy policy, set only when no
   * same-origin page was found. The page exists but is not hosted on the site. */
  privacyExternalUrl: string | null;
  cgvUrl: string | null;
  cgvStatus: number | null;
  dpaUrl: string | null;
  cookiesBannerDetected: boolean;
  cookiesBannerVendor: string | null;
  /**
   * Whether a DPO is mentioned *in the privacy policy*. `true`/`false` only
   * when the policy page was actually fetched and inspected; `null` when the
   * policy could not be retrieved (external host, unreachable) — in which
   * case the absence MUST NOT be asserted as a finding.
   */
  dpoMentioned: boolean | null;
  trackersDetected: string[];
}

export interface LighthouseFacts {
  fetched: boolean;
  /** Stable failure code, never a URL or raw browser error. */
  errorCode?: string;
  performance: number | null;
  accessibility: number | null;
  bestPractices: number | null;
  seo: number | null;
  lcpMs: number | null;
  clsScore: number | null;
  inpMs: number | null;
  tbtMs: number | null;
  totalByteWeight: number | null;
}

export interface AxeFacts {
  fetched: boolean;
  violations: {
    ruleId: string;
    impact: 'critical' | 'serious' | 'moderate' | 'minor';
    description: string;
    helpUrl: string;
    nodes: number;
  }[];
  passes: number;
  incomplete: number;
}

export interface ConversionFacts {
  pricingUrl: string | null;
  pricingIsAnchorOnly: boolean;
  contactUrl: string | null;
  contactHasPhone: boolean;
  contactHasEmail: boolean;
  contactHasForm: boolean;
  contactHasWhatsApp: boolean;
  testimonialsCount: number;
  testimonialsHaveName: boolean;
  testimonialsHavePhoto: boolean;
  trustLogosCount: number;
  ctaCount: number;
  ctaAboveFold: boolean;
}

export interface ContentFacts {
  wordCount: number;
  paragraphCount: number;
  internalLinksCount: number;
  externalLinksCount: number;
  hasFAQSection: boolean;
  hasBlogSection: boolean;
  blogUrl: string | null;
  /**
   * True when the site has no internal blog but links to an external one
   * (subdomain like blog.example.com, or a separate domain like the
   * founder's personal site founder-name.fr when the audit runs against
   * company.fr). Distinct from hasBlogSection so we can flag the SEO jus
   * loss explicitly.
   */
  hasExternalBlog: boolean;
  externalBlogUrl: string | null;
  fleschScore: number | null;
}

export interface UxFacts {
  hasMobileViewport: boolean;
  viewportBlocksZoom: boolean;
  hasSkipLink: boolean;
  navItemsCount: number;
  formsCount: number;
  hasSearch: boolean;
}

export interface UiFacts {
  fontFamiliesCount: number;
  inlineStylesBytes: number;
  themeColors: string[];
  contrastIssuesCount: number;
}

/**
 * Measurable "dated tech" signals, read straight from the raw HTML.
 *
 * The design demands that the CODE conclude "techno de 2012, pas
 * responsive, donc daté", not the vision LLM. Every field here is a hard
 * fact (regex on the document, version parse) — never a judgment. The
 * deterministic `ui.tech.outdated` rule combines them into a verdict that
 * corroborates (or contradicts) the qualitative "impression de modernité"
 * grid cell.
 */
export interface TechAgeFacts {
  /** Parsed jQuery major.minor if a jQuery script is referenced, else null.
   * jQuery <= 1.x strongly signals a pre-2016 build. */
  jqueryVersion: string | null;
  jqueryMajor: number | null;
  /** Parsed Bootstrap major if a bootstrap asset is referenced, else null.
   * Bootstrap <= 3 signals a pre-2018 design system. */
  bootstrapMajor: number | null;
  /** True when a <table> is used for page layout (no <th>, role!=grid,
   * or nested tables) — a hallmark of pre-responsive HTML. */
  layoutTablesDetected: boolean;
  layoutTablesCount: number;
  /** Deprecated presentational tags found (font, center, marquee,
   * frameset, blink, big, tt). Each one is a hard pre-HTML5 marker. */
  deprecatedTags: string[];
  /** True when the doctype is legacy (HTML 4.01 / XHTML) instead of the
   * HTML5 `<!doctype html>`. */
  legacyDoctype: boolean;
  /** True when the document declares no responsive viewport at all. */
  noResponsiveViewport: boolean;
  /** True when a Flash/Silverlight embed is present. Hard dead-tech. */
  flashEmbedDetected: boolean;
  /**
   * Code's verdict. `true` when enough measurable markers stack up. The
   * vision LLM never sets this — the collector does, deterministically.
   */
  isDated: boolean;
  /** Human-readable reasons the code concluded `isDated` (for evidence). */
  reasons: string[];
}

/**
 * Vision-LLM analysis of the rendered home page screenshot.
 *
 * Bridges the gap between HTML signature scanning (which sees structure)
 * and what a human sees (rendered layout, contrast, hierarchy). We call
 * Gemini 2.5 Flash with the full-page screenshot and a structured prompt
 * that returns numeric + boolean signals we can rule on.
 *
 * `fetched: false` means the vision pipeline did not run (no API key,
 * screenshot failure, API error, parse failure). Rules MUST treat
 * unfetched facts as "unknown" and not emit findings — never as
 * "everything is fine".
 */
export interface VisionFacts {
  fetched: boolean;
  /** Bytes of the captured PNG. 0 when fetched=false. */
  screenshotBytes: number;
  /** Gemini model id used (so dashboard can surface "analysed by ..."). */
  model: string | null;
  /**
   * Number of distinct testimonials a human reader would actually see
   * on the home page (named or not, with or without photo). Acts as a
   * sanity check against the HTML-only `conversion.testimonialsCount`.
   */
  visibleTestimonials: number;
  /**
   * True when at least one testimonial visibly carries a person name
   * (e.g. "Marie Lefevre, CEO, Acme") — distinct from anonymous quotes.
   */
  visibleTestimonialsHaveNamedAuthor: boolean;
  /** Number of distinct customer/partner logos visible on the home. */
  trustLogosVisible: number;
  /**
   * True when the hero clearly communicates what the company does and
   * who it serves within the first viewport. False when the LLM finds
   * the hero confusing, generic, or missing a clear value proposition.
   * null when the LLM declined to judge (e.g. non-FR/EN language).
   */
  heroHasClearValue: boolean | null;
  /**
   * Free-form list of issues spotted in the hero by the LLM. Examples :
   * "headline trop générique", "pas de CTA visible", "image masque le
   * texte". Empty array means none.
   */
  heroIssues: string[];
  /**
   * True when the primary CTA's contrast against its background is
   * insufficient (a button that blends into the surrounding area). null
   * when no clear primary CTA was identified.
   */
  ctaContrastIssue: boolean | null;
  /**
   * 0-10 LLM rating of overall visual hierarchy quality. Higher = clearer
   * progression from headline -> sub -> CTA -> proof.
   */
  visualHierarchyScore: number | null;
  /** 1-2 sentence FR summary of the visual verdict, for the audit narrative. */
  overallVerdict: string | null;

  // ---------------------------------------------------------------------
  // Subjective assessments — domain-aware UI / UX / copy judgment.
  // The collector receives the detected sector and feeds it into the
  // prompt so the LLM compares the site against its peers ("SaaS B2B in
  // 2026 : Stripe / Linear / Notion-tier" vs "artisan local : template
  // Shopify / Squarespace ordinaire").
  // ---------------------------------------------------------------------

  /** 0-10 design quality vs sector standard. null if undecidable. */
  designQualityScore: number | null;
  /** Adjectives describing visual feel : "épuré", "moderne", "daté"... */
  designAdjectives: string[];
  /** 0-10 brand cohesion of fonts / colors / spacing. */
  brandConsistencyScore: number | null;
  /** FR sentence comparing the design to the sector's typical bar. */
  designVsSectorVerdict: string | null;

  /** 0-10 nav clarity (descriptive vs mystery-meat labels). */
  navigationClarityScore: number | null;
  /** Concrete UX friction points spotted on the rendered page. */
  uxFrictionPoints: string[];
  /** FR sentence summarising the UX impression. */
  uxVerdict: string | null;

  /** Value-prop clarity verdict in the visible copy. */
  valuePropClarity: 'clear' | 'vague' | 'absent' | null;
  /** Concrete copywriting issues : jargon, generic, no proof, weak verbs. */
  copyToneIssues: string[];
  /** FR sentence summarising the copy impression. */
  copyVerdict: string | null;

  // ---------------------------------------------------------------------
  // Calibration signals (structured critique rubric).
  // These ground the subjective scores above in a more structured
  // assessment : Nielsen's 4 statically-evaluable heuristics + cognitive
  // load checklist + AI slop detection.
  // ---------------------------------------------------------------------

  /** True when the visual reads as generic AI-generated (cookie-cutter
   * dark gradient hero, identical card grid, etc.). null if undecidable. */
  aiSlopDetected: boolean | null;
  /** 0-16 total of the 4 statically-evaluable Nielsen heuristics
   * (match real world, consistency, recognition vs recall, aesthetic
   * minimalist) scored 0-4 each. null if undecidable. */
  nielsenStaticTotal: number | null;
  /** 0-8 number of cognitive-load checklist items the design fails on
   * (single focus, chunking, grouping, hierarchy, one-thing-at-a-time,
   * minimal choices, working memory, progressive disclosure). null if
   * undecidable. */
  cognitiveLoadFailures: number | null;

  // ---------------------------------------------------------------------
  // Closed-grid UI/UX rubric . The AUTHORITATIVE
  // source for qualitative UI/UX findings. Each entry is a named criterion
  // rated bon/neutre/probleme with a mandatory justification. Replaces the
  // free 0-10 scores above as the verdict driver — those scores remain in
  // the schema only as narrative colour, no longer thresholded by rules.
  // Empty array when the vision pipeline did not run.
  // ---------------------------------------------------------------------
  uiGrid: GridCriterionEntry[];
}

/** Aggregated facts produced by collectors, consumed by rules + LLM. */
export interface AuditFacts {
  url: string;
  scannedAt: string;
  http: HttpFacts;
  stack: StackSignal;
  meta: MetaFacts;
  images: ImageFacts;
  headings: HeadingFacts;
  sitemap: SitemapFacts;
  robots: RobotsFacts;
  legal: LegalFacts;
  lighthouse: LighthouseFacts;
  axe: AxeFacts;
  conversion: ConversionFacts;
  content: ContentFacts;
  ux: UxFacts;
  ui: UiFacts;
  techAge: TechAgeFacts;
  vision: VisionFacts;
  /** Optional for audits stored before the deterministic viewport collector. */
  designMeasurements?: DesignMeasurements;
  internalPagesCrawled: { url: string; status: number; bytes: number }[];
  /** True when every sampled internal page returns HTML identical to the home
   * page *before* JavaScript executes. This alone is NOT proof of a fake
   * one-page: JS-rendered sites legitimately ship an identical raw shell. */
  fakeOnePageDetected: boolean;
  /**
   * Result of re-checking a suspected one-page against the JavaScript-rendered
   * DOM (Playwright). `distinct` = rendered content differs, so the site is
   * JS-rendered, not a scam one-pager. `identical` = rendered DOM is also the
   * same, a genuine fake one-page. `unverified` = Playwright unavailable.
   */
  fakeOnePageRenderCheck: 'distinct' | 'identical' | 'unverified';
  errors: { phase: string; message: string }[];
}

/** Reference to a legal/technical standard backing a finding. */
export interface LegalRef {
  standard: 'RGAA' | 'WCAG' | 'RGPD' | 'LCEN' | 'EAA' | 'CNIL' | 'GOOGLE';
  version?: string;
  criterion?: string;
  url?: string;
  label: string;
}

/** A finding emitted by a rule against the facts. */
export interface Finding {
  id: string;
  ruleCode: string;
  axis: AuditAxis;
  severity: Severity;
  title: string;
  evidence: Record<string, unknown>;
  affectedUrls: string[];
  legalRefs: LegalRef[];
  effortDefault: Effort;
  /**
   * Whether this finding is a hard measurement (`deterministic`) or an
   * expert judgment (`qualitative`). Drives the score (only deterministic
   * findings penalise the mechanical axis score) and the chiffrage (only
   * deterministic findings are costed in time). Defaults to deterministic.
   */
  kind: FindingKind;
  /** Observation without a validated failure threshold: no score penalty or costing. */
  advisory?: boolean;
  /**
   * How many times the underlying error occurs on the page/site (e.g. 40
   * images without alt). Drives the per-occurrence part of the chiffrage.
   * `1` for one-shot findings (a single missing sitemap). Only meaningful
   * for deterministic findings.
   */
  occurrences: number;
  /** Filled by LLM step. Never edited after Zod validation. */
  narrative?: {
    constat: string;
    impactBusiness: string;
    recommandation: string;
    codeSnippet?: string;
  };
}

export interface AxisScore {
  axis: AuditAxis;
  score: number;
  band: 'excellent' | 'good' | 'fair' | 'poor' | 'critical';
  weight: number;
}

export interface SectorContext {
  detected: string;
  confidence: number;
  mainKpi: string;
  secondaryKpi: string;
  audienceNotes: string;
}

export interface AuditReport {
  url: string;
  scannedAt: string;
  sector: SectorContext;
  scores: AxisScore[];
  globalScore: number | null;
  globalBand: AxisScore['band'] | null;
  findings: Finding[];
  killerFindings: string[];
  execSummary: string;
  top3Priorities: {
    title: string;
    reason: string;
    findingIds?: string[];
    expectedOutcome?: string;
  }[];
  quickWins: string[];
  estimatedImpactNarrative: string;
  /** time-to-fix chiffrage over deterministic findings. */
  costEstimate: CostEstimate;
  /** correction-vs-redesign arbitrage + closed-CMS routing. */
  remediation: RemediationVerdict;
  facts: AuditFacts;
  /**
   * Préparation IA result (module ai_readiness). Absent when the module was
   * off: the report is then exactly the 8-axis one.
   */
  aiReadiness?: AiReadinessResult;
}

export interface CollectorContext {
  url: string;
  fetch: typeof fetch;
  logger: {
    info: (o: unknown, m?: string) => void;
    warn: (o: unknown, m?: string) => void;
    error: (o: unknown, m?: string) => void;
  };
  userAgent: string;
  timeoutMs: number;
  maxBytes: number;
}
