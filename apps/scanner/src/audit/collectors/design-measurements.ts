import type { Page } from 'playwright';
import { z } from 'zod';

import { checkUrlSafe } from '../../lib/url-guard.js';
import { auditUserAgent } from '../user-agent.js';

import { guardBrowserContext, withAuditBrowser, withPageDeadline } from './guarded-browser.js';

export const DESIGN_VIEWPORTS = [
  { viewport: 'desktop' as const, width: 1280, height: 800 },
  { viewport: 'mobile' as const, width: 390, height: 844 },
] as const;

const viewportSchema = z.object({
  viewport: z.enum(['desktop', 'mobile']),
  width: z.number().positive(),
  height: z.number().positive(),
  documentWidth: z.number().nonnegative(),
  horizontalOverflowPx: z.number().nonnegative(),
  overflowElements: z
    .array(z.object({ selector: z.string().max(240), left: z.number(), right: z.number() }))
    .max(50),
  smallTargets: z
    .array(
      z.object({
        selector: z.string().max(240),
        width: z.number(),
        height: z.number(),
        spacingException: z.boolean(),
        inlineException: z.boolean(),
      }),
    )
    .max(50),
  textSamples: z
    .array(
      z.object({
        selector: z.string().max(240),
        fontSizePx: z.number().nonnegative(),
        lineHeightPx: z.number().nonnegative().nullable(),
        approxCharactersPerLine: z.number().nonnegative(),
      }),
    )
    .max(50),
  truncated: z.boolean(),
});

export type DesignViewportMeasurements = z.infer<typeof viewportSchema>;
export interface DesignMeasurements {
  /** True only when both viewport measurements succeeded. Partial samples remain available. */
  fetched: boolean;
  viewports: DesignViewportMeasurements[];
}

// Static browser JavaScript: tsx/esbuild must never transform these callbacks
// or capture Node-side keepNames helpers. Only JSON-serialized parameters are
// appended at invocation; no website content is evaluated as source.
const DESIGN_MEASUREMENTS_EXPRESSION = String.raw`(({ viewport, width, height }) => {
  const MAX_ELEMENTS = 3000;
  const MAX_SAMPLES = 50;
  const REGION_HEIGHT = 2400;
  const nodes = document.querySelectorAll('body *');
  const all = [];
  for (let i = 0; i < Math.min(nodes.length, MAX_ELEMENTS); i += 1) {
    const el = nodes[i];
    if (el) all.push(el);
  }
  let truncated = nodes.length > MAX_ELEMENTS;
  const selector = (el) => {
    const parts = [];
    let node = el;
    for (let depth = 0; node && depth < 5; depth += 1) {
      const parent = node.parentElement;
      const index = parent ? Array.from(parent.children).indexOf(node) + 1 : 1;
      parts.unshift(node.tagName.toLowerCase() + ':nth-child(' + String(index) + ')');
      node = parent;
    }
    return parts.join(' > ').slice(0, 240);
  };
  const visible = all.slice(0, MAX_ELEMENTS).filter((el) => {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.bottom > 0 &&
      rect.top < REGION_HEIGHT &&
      style.display !== 'none' &&
      style.visibility === 'visible' &&
      Number(style.opacity) !== 0 &&
      !el.closest('[hidden], [inert], [aria-hidden="true"]')
    );
  });
  const overflowElements = [];
  const smallTargets = [];
  const textSamples = [];
  const targets = visible.filter(
    (el) =>
      el.matches(
        'a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[tabindex]',
      ) && !el.matches(':disabled,[aria-disabled="true"],[tabindex="-1"]'),
  );
  const rects = targets.map((el) => el.getBoundingClientRect());
  const add = (list, sample) => {
    if (list.length < MAX_SAMPLES) list.push(sample);
    else truncated = true;
  };
  for (const el of visible) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    // Record actual rendered line boxes as well as element boxes; never infer from raw HTML.
    const range = document.createRange();
    let left = rect.left;
    let right = rect.right;
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType !== Node.TEXT_NODE || !child.textContent?.trim()) continue;
      range.selectNodeContents(child);
      for (const line of Array.from(range.getClientRects())) {
        left = Math.min(left, line.left);
        right = Math.max(right, line.right);
      }
    }
    if (left < -1 || right > width + 1)
      add(overflowElements, { selector: selector(el), left, right });
    if (el.matches('p,h1,h2,h3,h4,h5,h6,li,label') && el.textContent.trim()) {
      const fontSizePx = Number.parseFloat(style.fontSize);
      const lineHeight = Number.parseFloat(style.lineHeight);
      if (Number.isFinite(fontSizePx) && fontSizePx > 0)
        add(textSamples, {
          selector: selector(el),
          fontSizePx,
          lineHeightPx: Number.isFinite(lineHeight) ? lineHeight : null,
          approxCharactersPerLine: Math.round(rect.width / (fontSizePx * 0.5)),
        });
    }
  }
  targets.forEach((el, index) => {
    const rect = rects[index];
    if (!rect || (rect.width >= 24 && rect.height >= 24)) return;
    // 24 CSS-pixel diameter circles about undersized targets must not intersect
    // another target (or another undersized target's circle). Geometry only;
    // equivalent controls, essential presentation and UA exceptions are not tested.
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const spacingException =
      nodes.length <= MAX_ELEMENTS &&
      rects.every((other, otherIndex) => {
        if (otherIndex === index) return true;
        if (other.width < 24 || other.height < 24) {
          return (
            Math.hypot(cx - other.left - other.width / 2, cy - other.top - other.height / 2) >=
            24
          );
        }
        const dx = Math.max(other.left - cx, 0, cx - other.right);
        const dy = Math.max(other.top - cy, 0, cy - other.bottom);
        return Math.hypot(dx, dy) >= 12;
      });
    const inlineException =
      el.matches('a[href]') &&
      getComputedStyle(el).display === 'inline' &&
      !!el.closest('p,li,dd,figcaption') &&
      Array.from(el.parentElement?.childNodes ?? []).some(
        (node) => node.nodeType === Node.TEXT_NODE && !!node.textContent?.trim(),
      );
    add(smallTargets, {
      selector: selector(el),
      width: rect.width,
      height: rect.height,
      spacingException,
      inlineException,
    });
  });
  const documentWidth = Math.max(
    document.documentElement.scrollWidth,
    document.body.scrollWidth,
  );
  return {
    viewport,
    width,
    height,
    documentWidth,
    horizontalOverflowPx: Math.max(0, documentWidth - width),
    overflowElements,
    smallTargets,
    textSamples,
    truncated,
  };
})`;

/** Observations, not WCAG conformance or usability scores. No clicks or form submissions.
 * Samples cover visible elements in the first 2400 CSS pixels, main document only.
 * Text lengths are approximate CSS measures, not an assertion about reading difficulty.
 */
export async function measureDesignPage(
  page: Page,
  viewport: (typeof DESIGN_VIEWPORTS)[number],
): Promise<DesignViewportMeasurements> {
  const result: unknown = await withPageDeadline(page, () =>
    page.evaluate(`${DESIGN_MEASUREMENTS_EXPRESSION}(${JSON.stringify(viewport)})`),
  );
  return viewportSchema.parse(result);
}

/** No API key required. One deadline covers launch, routing, DNS/body
 * waits, evaluation and cleanup. Redirected resources are unavailable. */
export async function collectDesignMeasurements(url: string): Promise<DesignMeasurements> {
  const viewports: DesignViewportMeasurements[] = [];
  const result = (): DesignMeasurements => ({
    fetched: viewports.length === DESIGN_VIEWPORTS.length,
    viewports: [...viewports],
  });
  return withAuditBrowser(
    async (browser, signal) => {
      if (!(await checkUrlSafe(url)).ok) return result();
      for (const viewport of DESIGN_VIEWPORTS) {
        signal.throwIfAborted();
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          userAgent: auditUserAgent(),
          serviceWorkers: 'block',
        });
        try {
          const state = await guardBrowserContext(context, signal);
          const page = await context.newPage();
          await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });
          if (!(await checkUrlSafe(page.url())).ok || state.isUnavailable()) continue;
          const measurement = await measureDesignPage(page, viewport);
          signal.throwIfAborted();
          if (!state.isUnavailable()) viewports.push(measurement);
        } catch {
          // Unavailable evidence never certifies a healthy viewport.
        } finally {
          await context.close().catch(() => undefined);
        }
      }
      return result();
    },
    () => ({ fetched: false, viewports: [...viewports] }),
  );
}
