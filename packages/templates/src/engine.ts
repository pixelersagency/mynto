import { Liquid } from 'liquidjs';
import sanitizeHtml from 'sanitize-html';

import { ensureContrastOnDark } from './color.js';
import type { ReportDataV1 } from './contract.js';
import { fontCss, type FontChoice } from './fonts.js';
import type { TemplateManifest } from './manifest.js';

/**
 * Report rendering engine.
 *
 * A template is pure data: Liquid markup (no code execution), CSS and a
 * manifest. Sandbox:
 *   - Liquid reads partials from the in-memory file map of the template only
 *     (no file system, no path outside the template), partial names are
 *     literals (checked at validation), so nothing user-controlled picks a
 *     file;
 *   - output is HTML-escaped by default and `raw` escapes too: report data
 *     comes from audited sites and is never trusted as markup;
 *   - strict filters and variables, render time / memory limits;
 *   - the rendered HTML goes through an allowlist sanitizer (no script, no
 *     event handler, no iframe/form/link/meta, no remote image);
 *   - template CSS is nested under `.mynto-report` (it cannot style the page
 *     around it) and was validated at import (no @import, no url()).
 * The same output serves the web report and the PDF (print mode).
 */

export interface TemplateBundle {
  manifest: TemplateManifest;
  /** Text files of the template, keyed by relative path (report.liquid, sections/x.liquid, report.css, print.css). */
  files: Record<string, string>;
  /** preview.png as base64, when present. */
  preview: string | null;
  builtin: boolean;
}

export interface RenderOptions {
  fonts: FontChoice;
  /** Font settings declared by the template (`heading_font`, `body_font`) override the global choice unless `inherit`. */
  fontsBase?: string;
}

export interface RenderResult {
  /** `<div class="mynto-report">…</div>`, sanitized. */
  html: string;
  /** Complete CSS: @font-face, brand variables, nested template CSS, print CSS, @page. */
  css: string;
}

export class TemplateRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemplateRenderError';
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function txt(v: unknown): string {
  return typeof v === 'string'
    ? v
    : typeof v === 'number' || typeof v === 'boolean'
      ? String(v)
      : '';
}

function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function createLiquid(files: Record<string, string>): Liquid {
  const templates: Record<string, string> = {};
  for (const [p, content] of Object.entries(files)) {
    if (p.endsWith('.liquid')) templates[p] = content;
  }
  const engine = new Liquid({
    templates,
    extname: '.liquid',
    relativeReference: false,
    // Partial names must be quoted literals: validate.ts rejects anything else,
    // so no data value can pick a partial.
    dynamicPartials: true,
    strictFilters: true,
    strictVariables: true,
    lenientIf: true,
    ownPropertyOnly: true,
    outputEscape: 'escape',
    jekyllInclude: false,
    parseLimit: 2_000_000,
    renderLimit: 4_000,
    memoryLimit: 64 * 1024 * 1024,
    cache: false,
    greedy: false,
  });

  // `raw` would print audited-site data as markup: it escapes too.
  engine.registerFilter('raw', (v: unknown) => escapeHtml(txt(v)));

  engine.registerFilter('fr_number', (v: unknown, digits: unknown = 0) =>
    new Intl.NumberFormat('fr-FR', { maximumFractionDigits: toNum(digits) }).format(toNum(v)),
  );
  engine.registerFilter(
    'euros',
    (v: unknown) =>
      `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(toNum(v))} €`,
  );
  engine.registerFilter('band', (v: unknown) => {
    if (v === null || v === undefined || v === '') return 'none';
    const n = toNum(v);
    return n >= 80 ? 'good' : n >= 50 ? 'fair' : 'poor';
  });
  engine.registerFilter('band_label', (v: unknown) => {
    if (v === null || v === undefined || v === '') return 'Non évalué';
    const n = toNum(v);
    return n >= 80 ? 'Bon' : n >= 50 ? 'À améliorer' : 'Critique';
  });
  // SVG ring: stroke-dasharray for a circle of radius r filled at score/100.
  engine.registerFilter('ring_dash', (v: unknown, r: unknown = 52) => {
    const c = 2 * Math.PI * toNum(r);
    const filled = (Math.max(0, Math.min(100, toNum(v))) / 100) * c;
    return `${filled.toFixed(2)} ${(c - filled + 0.01).toFixed(2)}`;
  });
  engine.registerFilter('pct', (v: unknown, total: unknown = 100) => {
    const t = toNum(total);
    return t <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((toNum(v) / t) * 100)));
  });
  engine.registerFilter('plural', (n: unknown, one: unknown, many: unknown) =>
    toNum(n) > 1 ? txt(many) : txt(one),
  );
  engine.registerFilter('date_fr', (v: unknown) => {
    const d = new Date(txt(v));
    if (Number.isNaN(d.getTime())) return txt(v);
    return new Intl.DateTimeFormat('fr-FR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'Europe/Paris',
    }).format(d);
  });
  engine.registerFilter('initial', (v: unknown) => txt(v).trim().charAt(0).toUpperCase());
  engine.registerFilter('anchor', (v: unknown) =>
    txt(v)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60),
  );
  // Radar chart helpers: spoke `index` of `count`, starting at 12 o'clock,
  // clockwise. `v` is a percentage of `radius` (0 to 200, labels sit past 100).
  const angle = (i: unknown, n: unknown): number =>
    (2 * Math.PI * toNum(i)) / Math.max(1, Math.round(toNum(n)));
  const share = (v: unknown): number => Math.max(0, Math.min(200, toNum(v))) / 100;
  engine.registerFilter('radar_x', (v: unknown, i: unknown, n: unknown, r: unknown, c: unknown) =>
    (toNum(c) + toNum(r) * share(v) * Math.sin(angle(i, n))).toFixed(1),
  );
  engine.registerFilter('radar_y', (v: unknown, i: unknown, n: unknown, r: unknown, c: unknown) =>
    (toNum(c) - toNum(r) * share(v) * Math.cos(angle(i, n))).toFixed(1),
  );
  const point = (v: number, i: number, n: number, r: number, c: number): string =>
    `${(c + r * share(v) * Math.sin(angle(i, n))).toFixed(1)},${(c - r * share(v) * Math.cos(angle(i, n))).toFixed(1)}`;
  engine.registerFilter('radar_ring', (v: unknown, n: unknown, r: unknown, c: unknown) => {
    const count = Math.max(3, Math.min(24, Math.round(toNum(n))));
    return Array.from({ length: count }, (_, i) =>
      point(toNum(v), i, count, toNum(r), toNum(c)),
    ).join(' ');
  });
  // Polygon of the axis scores. An axis not evaluated sits at the centre; the
  // template labels it « – », never as a score.
  engine.registerFilter('radar_points', (axes: unknown, r: unknown, c: unknown) => {
    if (!Array.isArray(axes) || axes.length === 0) return '';
    const list = axes.slice(0, 24) as unknown[];
    return list
      .map((a, i) => {
        const o = (a ?? {}) as { evaluated?: unknown; score?: { value?: unknown } };
        const v = o.evaluated === true && typeof o.score?.value === 'number' ? o.score.value : 0;
        return point(Math.min(100, v), i, list.length, toNum(r), toNum(c));
      })
      .join(' ');
  });
  engine.registerFilter('radar_anchor', (i: unknown, n: unknown) => {
    const s = Math.sin(angle(i, n));
    return Math.abs(s) < 0.3 ? 'middle' : s > 0 ? 'start' : 'end';
  });
  return engine;
}

/** Filters added to the Liquid standard ones (documented in docs/templates/README.md). */
export const CUSTOM_FILTERS = [
  'fr_number',
  'euros',
  'band',
  'band_label',
  'ring_dash',
  'pct',
  'plural',
  'date_fr',
  'initial',
  'anchor',
  'radar_x',
  'radar_y',
  'radar_ring',
  'radar_points',
  'radar_anchor',
] as const;

const SVG_TAGS = [
  'svg',
  'g',
  'path',
  'circle',
  'ellipse',
  'rect',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'defs',
  'lineargradient',
  'radialgradient',
  'stop',
  'title',
  'desc',
  'use',
  'symbol',
  'clippath',
  'mask',
];

const SVG_ATTRS = [
  'viewbox',
  'viewBox',
  'xmlns',
  'width',
  'height',
  'fill',
  'fill-opacity',
  'fill-rule',
  'clip-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'dx',
  'dy',
  'points',
  'transform',
  'opacity',
  'offset',
  'stop-color',
  'stop-opacity',
  'gradientunits',
  'gradientTransform',
  'text-anchor',
  'dominant-baseline',
  'font-size',
  'font-weight',
  'preserveaspectratio',
  'preserveAspectRatio',
  'focusable',
  'pathlength',
  'pathLength',
  'clip-path',
  'href',
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'div',
    'span',
    'p',
    'a',
    'img',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'section',
    'article',
    'header',
    'footer',
    'main',
    'nav',
    'aside',
    'figure',
    'figcaption',
    'ul',
    'ol',
    'li',
    'dl',
    'dt',
    'dd',
    'strong',
    'em',
    'b',
    'i',
    'u',
    'small',
    'mark',
    'abbr',
    'sup',
    'sub',
    'br',
    'hr',
    'code',
    'pre',
    'blockquote',
    'q',
    'cite',
    'time',
    'details',
    'summary',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'caption',
    'colgroup',
    'col',
    'button',
    'meter',
    'progress',
    ...SVG_TAGS,
  ],
  allowedAttributes: {
    '*': [
      'class',
      'id',
      'role',
      'title',
      'lang',
      'dir',
      'hidden',
      'tabindex',
      'style',
      'aria-*',
      'data-*',
    ],
    a: ['href', 'target', 'rel', 'download'],
    img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
    time: ['datetime'],
    details: ['open'],
    button: ['type', 'disabled'],
    th: ['scope', 'colspan', 'rowspan'],
    td: ['colspan', 'rowspan', 'headers'],
    col: ['span'],
    meter: ['min', 'max', 'low', 'high', 'optimum', 'value'],
    progress: ['max', 'value'],
    ol: ['start', 'reversed'],
    ...Object.fromEntries(SVG_TAGS.map((t) => [t, SVG_ATTRS])),
  },
  allowedStyles: {
    '*': {
      width: [/^\d{1,3}(\.\d+)?(%|px|rem|em)$/],
      height: [/^\d{1,3}(\.\d+)?(%|px|rem|em)$/],
      '--pct': [/^\d{1,3}(\.\d+)?%?$/],
      '--value': [/^-?\d{1,4}(\.\d+)?$/],
      '--i': [/^\d{1,3}$/],
      '--tone': [/^[a-z-]{1,20}$/],
    },
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: [] },
  allowedSchemesAppliedToAttributes: ['href', 'src'],
  allowProtocolRelative: false,
  parser: { lowerCaseAttributeNames: false },
  transformTags: {
    // External links never leak the report URL (tracking token) or open a handle back.
    a: (tagName, attribs) => {
      const href = attribs.href ?? '';
      if (/^https?:\/\//i.test(href)) {
        return {
          tagName,
          attribs: { ...attribs, rel: 'noopener noreferrer', target: attribs.target ?? '_blank' },
        };
      }
      return { tagName, attribs };
    },
    // Only same-origin images (/media/…, /fonts/…), never a remote tracker.
    img: (tagName, attribs) => {
      const src = attribs.src ?? '';
      return {
        tagName,
        attribs: /^\/[A-Za-z0-9/._?=&-]*$/.test(src) ? attribs : { ...attribs, src: '' },
      };
    },
    use: (tagName, attribs) => {
      const href = attribs.href ?? '';
      return { tagName, attribs: href.startsWith('#') ? attribs : { ...attribs, href: '' } };
    },
  },
};

export function sanitizeReportHtml(html: string): string {
  return sanitizeHtml(html, SANITIZE_OPTIONS);
}

/** Brand + font variables, set on the report root. */
function rootVariables(data: ReportDataV1, stacks: { heading: string; body: string }): string {
  const a = data.agency;
  return [
    `--mr-brand:${a.color}`,
    `--mr-brand-text:${a.color_text}`,
    `--mr-on-brand:${a.on_color}`,
    `--mr-brand-soft:color-mix(in srgb, ${a.color} 9%, white)`,
    `--mr-brand-line:color-mix(in srgb, ${a.color} 28%, white)`,
    `--mr-brand-on-dark:${ensureContrastOnDark(a.color).color}`,
    `--mr-font-heading:${stacks.heading}`,
    `--mr-font-body:${stacks.body}`,
  ].join(';');
}

function pickFont(setting: unknown, global: string): string {
  return typeof setting === 'string' && setting !== 'inherit' && setting.length > 0
    ? setting
    : global;
}

/** CSS string literal (quotes, backslashes and newlines removed). */
function cssContent(s: string): string {
  return `"${s.replace(/["\\\n\r]/g, ' ').slice(0, 120)}"`;
}

/**
 * Moves top-level @keyframes out of the template CSS: the rest is nested
 * under .mynto-report, where @keyframes is not allowed.
 */
export function hoistKeyframes(css: string): { rest: string; keyframes: string[] } {
  const keyframes: string[] = [];
  let rest = '';
  let i = 0;
  const re = /@(-webkit-)?keyframes\s+[A-Za-z0-9_-]+\s*\{/g;
  for (let m = re.exec(css); m !== null; m = re.exec(css)) {
    let depth = 1;
    let j = m.index + m[0].length;
    while (j < css.length && depth > 0) {
      if (css[j] === '{') depth += 1;
      else if (css[j] === '}') depth -= 1;
      j += 1;
    }
    rest += css.slice(i, m.index);
    keyframes.push(css.slice(m.index, j));
    i = j;
    re.lastIndex = j;
  }
  rest += css.slice(i);
  return { rest, keyframes };
}

/** Renders a template on report data. Throws TemplateRenderError on a Liquid error. */
export async function renderTemplate(
  bundle: TemplateBundle,
  data: ReportDataV1,
  opts: RenderOptions,
): Promise<RenderResult> {
  const main = bundle.files['report.liquid'];
  if (main === undefined) throw new TemplateRenderError('report.liquid manquant');
  const engine = createLiquid(bundle.files);
  let body: string;
  try {
    body = (await engine.parseAndRender(
      main,
      data as unknown as Record<string, unknown>,
    )) as string;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TemplateRenderError(msg.slice(0, 500));
  }

  const choice: FontChoice = {
    heading: pickFont(data.settings.heading_font, opts.fonts.heading),
    body: pickFont(data.settings.body_font, opts.fonts.body),
    custom: opts.fonts.custom,
  };
  const fonts = fontCss(choice, opts.fontsBase ?? '/fonts');
  const vars = rootVariables(data, fonts);
  const screen = hoistKeyframes(bundle.files['report.css'] ?? '');
  const print = hoistKeyframes(bundle.files['print.css'] ?? '');
  const footerLabel = cssContent(`${data.agency.name}, audit de ${data.audit.host}`);
  const css = [
    fonts.css,
    `.mynto-report{${vars}}`,
    `.mynto-report{\n${screen.rest}\n}`,
    print.rest.trim() ? `@media print{.mynto-report{\n${print.rest}\n}}` : '',
    ...screen.keyframes,
    ...print.keyframes,
    // Page margin boxes inherit from the page context, not from .mynto-report:
    // the report body font is set here explicitly, or Chromium falls back to serif.
    `@page{size:A4;margin:16mm 16mm 18mm;@bottom-left{content:${footerLabel};font-family:${fonts.body};font-size:8pt;color:#71717a}@bottom-right{content:counter(page) " / " counter(pages);font-family:${fonts.body};font-size:8pt;font-variant-numeric:tabular-nums;color:#71717a}}`,
  ]
    .filter(Boolean)
    .join('\n');

  const html = sanitizeReportHtml(
    `<div class="mynto-report" data-template="${escapeHtml(bundle.manifest.id)}" data-mode="${data.mode}">${body}</div>`,
  );
  return { html, css };
}

/** Standalone HTML document (CLI preview, MCP preview, axe checks). */
export function toDocument(result: RenderResult, title: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>html,body{margin:0;padding:0;background:#fff}</style>
<style>${result.css.replace(/<\/style/gi, '<\\/style')}</style>
</head>
<body>
<main id="main">${result.html}</main>
</body>
</html>`;
}
