/**
 * Portable, DOM-readable checks shared by the scanner and the Chrome
 * extension. The split is deliberate :
 *
 *   - `extractDomFacts(document)` is the ONLY browser-coupled part. It runs
 *     in the extension content script (real DOM) or against jsdom.
 *   - Every axis evaluator takes the plain `DomFacts` object and returns an
 *     `AxisResult`. Pure functions, fully testable without a DOM.
 *
 * These checks are the INSTANT, in-browser half of an audit (what a human
 * sees on the rendered page). The heavy half — Lighthouse, axe-core, the
 * vision grid, the 20-page crawl, the chiffrage — stays in the scanner and
 * is requested via the "Rapport complet" button.
 */

export type AuditAxis =
  | 'seo_technique'
  | 'seo_contenu'
  | 'performance'
  | 'accessibilite'
  | 'conformite'
  | 'conversion'
  | 'ux'
  | 'ui';

export const ALL_AXES: readonly AuditAxis[] = [
  'seo_technique',
  'seo_contenu',
  'performance',
  'accessibilite',
  'conformite',
  'conversion',
  'ux',
  'ui',
];

export const AXIS_LABEL: Record<AuditAxis, string> = {
  seo_technique: 'SEO Technique',
  seo_contenu: 'SEO Contenu',
  performance: 'Performance',
  accessibilite: 'Accessibilité',
  conformite: 'Conformité',
  conversion: 'Conversion',
  ux: 'UX',
  ui: 'UI',
};

/** A single check outcome. `pass` = good, `warn` = improvable, `fail` =
 * problem, `info` = neutral fact (not scored). */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface CheckResult {
  /** Stable id, e.g. "seo.title.length". */
  id: string;
  /** Short FR label shown in the extension. */
  label: string;
  status: CheckStatus;
  /** One-line FR detail of what was found. */
  detail: string;
  /** Optional concrete value (count, length, etc.) for display. */
  value?: string | number;
}

export interface AxisResult {
  axis: AuditAxis;
  /** 0-100 score for this axis (shown /100). */
  score: number;
  checks: CheckResult[];
}

export interface ChecksReport {
  url: string;
  /** Per-axis results in canonical order. */
  axes: AxisResult[];
  /** 0-100 weighted global score. */
  globalScore: number;
}

/**
 * Flat, serialisable snapshot of everything the local checks need, read
 * once from the rendered DOM. Kept JSON-friendly so it can cross the
 * content-script -> popup message boundary.
 */
export interface DomFacts {
  url: string;
  origin: string;
  lang: string | null;
  // --- head / meta ---
  title: string | null;
  metaDescription: string | null;
  canonical: string | null;
  robotsMeta: string | null;
  viewport: string | null;
  charset: string | null;
  themeColor: string | null;
  ogTags: Record<string, string>;
  twitterTags: Record<string, string>;
  hreflangs: { lang: string; href: string }[];
  jsonLdCount: number;
  jsonLdTypes: string[];
  faviconHref: string | null;
  // --- headings ---
  h1Count: number;
  h1Texts: string[];
  headingOutline: { level: number; text: string }[];
  headingHierarchyBroken: boolean;
  // --- images ---
  imagesTotal: number;
  imagesWithAlt: number;
  imagesEmptyAlt: number;
  imagesLazy: number;
  imagesWithDimensions: number;
  imagesOversized: number; // natural >> displayed
  // --- links ---
  linksInternal: number;
  linksExternal: number;
  linksNoText: number; // anchors without accessible text
  linksNewTabNoRel: number; // target=_blank without rel noopener
  // --- content ---
  wordCount: number;
  paragraphCount: number;
  hasBlogLink: boolean;
  textLangSampleFrench: boolean;
  // --- forms / nav / structure ---
  navItems: number;
  formsCount: number;
  inputsWithoutLabel: number;
  hasSearch: boolean;
  hasSkipLink: boolean;
  landmarks: { header: boolean; nav: boolean; main: boolean; footer: boolean };
  // --- conversion signals ---
  ctaButtons: number;
  hasPhoneLink: boolean;
  hasMailtoLink: boolean;
  hasContactLink: boolean;
  testimonialHints: number;
  trustLogoHints: number;
  // --- conformité signals ---
  legalLinks: { mentions: boolean; privacy: boolean; cgv: boolean; cookies: boolean };
  trackers: string[];
  cookieBannerVendor: string | null;
  // --- performance signals (local heuristics) ---
  domNodeCount: number;
  scriptCount: number;
  inlineScriptCount: number;
  stylesheetCount: number;
  renderBlockingStyles: number; // <link rel=stylesheet> in <head> without media
  inlineStyleBytes: number;
  totalImageBytesEstimate: number; // sum of naturalWidth*height heuristic, 0 if unknown
  isHttps: boolean;
  // --- UI signals ---
  fontFamilies: string[];
  colorCount: number; // distinct text/bg colors sampled
  usesViewportMeta: boolean;
  viewportBlocksZoom: boolean;
  // --- dated-tech markers (mirror scanner tech-age) ---
  jqueryMajor: number | null;
  bootstrapMajor: number | null;
  deprecatedTags: string[];
  flashDetected: boolean;
  legacyDoctype: boolean;
  layoutTables: number;
  // --- generic ---
  generatorMeta: string | null;
  detectedCms: string | null;
}
