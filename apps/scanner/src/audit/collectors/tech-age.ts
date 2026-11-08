import type { TechAgeFacts } from '../types.js';

/**
 * Deterministic "dated tech" detector.
 *
 * The design requires the CODE to conclude that a site is
 * dated from measurable signals, instead of letting the vision LLM judge
 * "looks old". This collector parses the RAW pre-JavaScript HTML for hard
 * markers: legacy library versions, layout tables, deprecated tags, Flash
 * embeds, missing responsive viewport, legacy doctype. It then stacks the
 * markers into a boolean `isDated` verdict with explicit reasons.
 *
 * Why raw HTML, not the rendered DOM: a modern SPA can ship a clean
 * rendered DOM while the served document still carries the old markers we
 * care about. We want the served bytes, the way they actually are.
 *
 * NEVER throws. Worst case returns an all-false TechAgeFacts.
 */

// jQuery <= 1.x is the strongest single age marker (pre-2016). We capture
// major.minor from common CDN / bundle naming: jquery-1.12.4.min.js,
// jquery/3.6.0/jquery.min.js, jquery-2.2.4.js, etc.
const JQUERY_VERSION_RE = /jquery[/-](\d+)\.(\d+)(?:\.(\d+))?/i;

// Bootstrap CORE major from asset paths: bootstrap-3.3.7, bootstrap@4,
// bootstrap/4.5.2. The negative lookbehind `(?<![a-z0-9-])` anchors the
// token so derivatives are NOT mis-read as Bootstrap core:
//   react-bootstrap-1.6  -> preceded by '-' -> NO match (it's a modern
//                           React lib versioned independently)
//   bootstrap-vue-2.23   -> 'bootstrap' not followed by a version -> NO match
// We accept the resulting false negatives (version embedded earlier in the
// path) as the conservative trade : never call a modern site "dated".
const BOOTSTRAP_VERSION_RE = /(?<![a-z0-9-])bootstrap[@/._-]?(\d+)\.(\d+)/i;

// Pre-HTML5 presentational tags. Each is a hard marker of a pre-2014 build.
const DEPRECATED_TAGS = ['font', 'center', 'marquee', 'frameset', 'blink', 'tt'] as const;

interface TechAgeInput {
  /** Raw, pre-JavaScript HTML document. */
  rawHtml: string;
  /** Whether a responsive viewport meta was found (from UxFacts). */
  hasMobileViewport: boolean;
}

export function detectTechAge(input: TechAgeInput): TechAgeFacts {
  const html = input.rawHtml;
  const reasons: string[] = [];

  // --- jQuery version -----------------------------------------------------
  let jqueryVersion: string | null = null;
  let jqueryMajor: number | null = null;
  const jqMatch = JQUERY_VERSION_RE.exec(html);
  if (jqMatch) {
    const major = Number(jqMatch[1]);
    const minor = Number(jqMatch[2]);
    jqueryMajor = major;
    jqueryVersion = `${String(major)}.${String(minor)}`;
    if (major <= 1) {
      reasons.push(`jQuery ${jqueryVersion} (version pré-2016, fin de support)`);
    }
  }

  // --- Bootstrap version --------------------------------------------------
  let bootstrapMajor: number | null = null;
  const bsMatch = BOOTSTRAP_VERSION_RE.exec(html);
  if (bsMatch) {
    const major = Number(bsMatch[1]);
    bootstrapMajor = major;
    if (major <= 3) {
      reasons.push(`Bootstrap ${String(major)}.x (système de design pré-2018, non flex/grid)`);
    }
  }

  // --- Layout tables ------------------------------------------------------
  // A <table> is "layout" when it has no <th> and is not explicitly a data
  // grid (role=grid / role=table). Nested tables are an even stronger
  // tell. We count from the raw HTML with a tolerant regex pass rather
  // than a full parse (cheap, and good enough for a binary signal).
  const { layoutTablesCount, nested } = countLayoutTables(html);
  const layoutTablesDetected = layoutTablesCount > 0;
  if (layoutTablesDetected) {
    reasons.push(
      `${String(layoutTablesCount)} table(s) de mise en page${nested ? ' (dont imbriquées)' : ''} - HTML pré-responsive`,
    );
  }

  // --- Deprecated presentational tags ------------------------------------
  const deprecatedTags: string[] = [];
  for (const tag of DEPRECATED_TAGS) {
    const re = new RegExp(`<${tag}[\\s>/]`, 'i');
    if (re.test(html)) deprecatedTags.push(tag);
  }
  if (deprecatedTags.length > 0) {
    reasons.push(`Balises dépréciées : <${deprecatedTags.join('>, <')}>`);
  }

  // --- Legacy doctype -----------------------------------------------------
  // HTML5 is `<!doctype html>`. Anything mentioning HTML 4.01 / XHTML / DTD
  // is a pre-2014 document.
  const doctypeMatch = /<!doctype\s+([^>]*)>/i.exec(html);
  const legacyDoctype = doctypeMatch
    ? /(html 4|xhtml|\/\/dtd|transitional|frameset)/i.test(doctypeMatch[1] ?? '')
    : false;
  if (legacyDoctype) {
    reasons.push('Doctype legacy (HTML 4.01 / XHTML)');
  }

  // --- Responsive viewport ------------------------------------------------
  // Recorded as a fact, but its reason is only surfaced when the site is
  // already dated for a hard reason (it never flips the verdict alone, so
  // emitting "no viewport" on a clean modern site would be misleading).
  const noResponsiveViewport = !input.hasMobileViewport;

  // --- Flash / Silverlight ------------------------------------------------
  const flashEmbedDetected =
    /<embed[^>]+(?:application\/x-shockwave-flash|\.swf)/i.test(html) ||
    /<object[^>]+(?:application\/x-shockwave-flash|clsid:D27CDB6E)/i.test(html) ||
    /\.swf\b/i.test(html);
  if (flashEmbedDetected) {
    reasons.push('Contenu Flash détecté (technologie morte depuis 2020)');
  }

  // --- Verdict ------------------------------------------------------------
  // A single hard marker (Flash, deprecated tags, legacy doctype, layout
  // tables, old jQuery/Bootstrap) is enough on its own; the missing
  // viewport alone is weaker, so it needs a second corroborating signal.
  const hardMarkers =
    (jqueryMajor !== null && jqueryMajor <= 1 ? 1 : 0) +
    (bootstrapMajor !== null && bootstrapMajor <= 3 ? 1 : 0) +
    (layoutTablesDetected ? 1 : 0) +
    (deprecatedTags.length > 0 ? 1 : 0) +
    (legacyDoctype ? 1 : 0) +
    (flashEmbedDetected ? 1 : 0);

  // One hard marker is enough. The missing viewport alone is too weak to
  // call a clean modern site "dated", so it never flips the verdict by
  // itself (hardMarkers already covers every corroborating signal).
  const isDated = hardMarkers >= 1;

  // Surface the weak viewport signal only as supporting context on an
  // already-dated site.
  if (isDated && noResponsiveViewport) {
    reasons.push('Aucun viewport responsive (non adapté mobile)');
  }

  return {
    jqueryVersion,
    jqueryMajor,
    bootstrapMajor,
    layoutTablesDetected,
    layoutTablesCount,
    deprecatedTags,
    legacyDoctype,
    noResponsiveViewport,
    flashEmbedDetected,
    isDated,
    reasons,
  };
}

/**
 * Counts <table> elements that are LAYOUT tables, conservatively.
 *
 * "No <th>" alone is NOT enough : a legitimate data table (pricing / specs,
 * common in WP plugins) frequently ships headers as <td> and would be a
 * false positive. We therefore require a POSITIVE layout signal :
 *   - a presentational attribute on the <table> start tag
 *     (cellpadding / cellspacing / border / bgcolor / background /
 *      align / width="...%"), the hallmark of pre-CSS layout, OR
 *   - a nested <table> (tables-in-tables is layout, never data).
 * A bare <table> with no <th> and no layout signal is left UNcounted :
 * ambiguous, so we say nothing rather than risk a false positive.
 */
const LAYOUT_TABLE_ATTRS =
  /\b(?:cellpadding|cellspacing|bgcolor|background|border)\s*=|\balign\s*=\s*["']?(?:left|right|center)|\bwidth\s*=\s*["']?\d+%/i;

function countLayoutTables(html: string): { layoutTablesCount: number; nested: boolean } {
  const lower = html.toLowerCase();
  let count = 0;
  let nested = false;
  let searchFrom = 0;
  let guard = 0;

  while (guard < 500) {
    guard += 1;
    const open = lower.indexOf('<table', searchFrom);
    if (open === -1) break;
    const close = lower.indexOf('</table', open);
    const segmentEnd = close === -1 ? lower.length : close;
    const segment = lower.slice(open, segmentEnd);

    // Attribute check runs on the start tag only (`<table ...>`), which
    // sidesteps the nested-slice imprecision on the inner content.
    const startTagEnd = segment.indexOf('>');
    const startTag = startTagEnd === -1 ? segment : segment.slice(0, startTagEnd + 1);

    const hasTh = /<th[\s>]/.test(segment);
    const isDataGrid = /role\s*=\s*["'](grid|table)["']/.test(segment);
    const hasNestedTable = segment.includes('<table', 6);
    if (hasNestedTable) nested = true;

    const hasLayoutAttrs = LAYOUT_TABLE_ATTRS.test(startTag);

    // Layout only on a POSITIVE signal and not a declared data grid.
    if (!isDataGrid && !hasTh && (hasLayoutAttrs || hasNestedTable)) count += 1;

    searchFrom = open + 6;
  }

  return { layoutTablesCount: count, nested };
}
