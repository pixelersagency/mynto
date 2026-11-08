import { chromium, type Browser } from 'playwright';

import { checkUrlSafe } from '../../lib/url-guard.js';
import { auditUserAgent } from '../user-agent.js';

import { dismissConsentOverlays } from './dismiss-consent.js';

/**
 * Captures a single viewport-sized screenshot of the audited home page,
 * persisted on the public audit report so the prospect sees "this is your
 * hero" alongside the score.
 *
 * Distinct from `collectors/vision.ts`:
 *   - vision.ts takes a FULL-page PNG (whole document scroll) for the
 *     Gemini analysis. Heavy, gated on the daily quota.
 *   - hero-screenshot.ts takes a SINGLE viewport (no fullPage) so the
 *     report shows the first impression a visitor gets. Light, always
 *     runs when scanner has Playwright available.
 *
 * SSRF posture mirrors the vision collector: every subresource the
 * Chromium target tries to fetch is re-checked against `checkUrlSafe`
 * and aborted if it resolves to a private IP / localhost / cloud
 * metadata endpoint. The final URL after redirects is re-validated.
 *
 * RAM posture: viewport-only capture caps the screenshot at ~150 KB so
 * the constraint is irrelevant here; we still set a body height cap as
 * defense in depth so a hostile page cannot starve the worker.
 *
 * Returns null on any failure (timeout, navigation error, unsafe final
 * URL, oversize) — never throws. The audit must complete even when the
 * hero capture fails.
 */

const VIEWPORT_WIDTH = 1280;
const VIEWPORT_HEIGHT = 800;
const PAGE_TIMEOUT_MS = 20_000;
const MAX_SCREENSHOT_BYTES = 1 * 1024 * 1024; // 1 MB cap for hero (viewport only)
const MAX_PAGE_HEIGHT_PX = 5_000;

export async function captureHeroScreenshot(url: string): Promise<Buffer | null> {
  const safe = await checkUrlSafe(url);
  if (!safe.ok) return null;

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: auditUserAgent(),
      viewport: { width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT },
      serviceWorkers: 'block',
    });

    // SSRF guard on every subresource. Same logic as vision.ts.
    // The `.catch()` is mandatory : a rejected checkUrlSafe would leave
    // the request hanging until the page-load timeout fires, wasting
    // worker capacity without an outright vulnerability.
    await context.route('**/*', (route) => {
      const reqUrl = route.request().url();
      void checkUrlSafe(reqUrl)
        .then((s) => (s.ok ? route.continue() : route.abort('blockedbyclient')))
        .catch(() => route.abort('blockedbyclient'));
    });

    const page = await context.newPage();
    const response = await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: PAGE_TIMEOUT_MS,
    });

    const finalUrl = response?.url() ?? url;
    const finalSafe = await checkUrlSafe(finalUrl);
    if (!finalSafe.ok) return null;

    await page
      .evaluate((max: number) => {
        document.body.style.maxHeight = `${String(max)}px`;
        document.body.style.overflow = 'hidden';
      }, MAX_PAGE_HEIGHT_PX)
      .catch(() => undefined);

    // Hide GDPR / consent banners so the hero capture shows the actual
    // first impression, not a Didomi/OneTrust overlay covering the fold.
    await dismissConsentOverlays(page);

    // Viewport-only screenshot — fullPage:false (default). Captures
    // exactly what a visitor sees above the fold.
    const png = await page.screenshot({ fullPage: false, type: 'png' });
    await context.close();
    if (png.length > MAX_SCREENSHOT_BYTES) return null;
    return png;
  } catch {
    return null;
  } finally {
    if (browser !== null) {
      await browser.close().catch(() => undefined);
    }
  }
}
