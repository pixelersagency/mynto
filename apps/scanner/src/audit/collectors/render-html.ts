import { chromium, type Browser } from 'playwright';

import { checkUrlSafe } from '../../lib/url-guard.js';
import { auditUserAgent } from '../user-agent.js';

import { isBlockedRequestUrl } from './safe-fetch.js';

const NAV_TIMEOUT_MS = 25_000;

/**
 * Fetch the fully JavaScript-rendered HTML of a page, the way a modern
 * search engine sees it (Googlebot renders with headless Chromium).
 *
 * The HTTP-only probe misses everything injected client-side: SPA content,
 * JS-rendered navigation, lazy-mounted headings, GTM-injected JSON-LD,
 * consent banners. Running the cheerio collectors on the rendered DOM
 * removes a whole class of false positives (thin content, missing nav,
 * missing H1, missing structured data...) on JS-rendered sites.
 *
 * Best-effort: returns `null` on any failure (blocked URL, navigation
 * timeout, browser crash) so the caller transparently falls back to the
 * raw HTML.
 */
export async function renderHtml(url: string): Promise<string | null> {
  const safe = await checkUrlSafe(url);
  if (!safe.ok) return null;

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: auditUserAgent() });
    // Block requests (navigation redirects + subresources) to private IPs
    // and internal hostnames so a hostile page cannot pull the headless
    // browser into the internal network.
    await context.route('**/*', (route) => {
      if (isBlockedRequestUrl(route.request().url())) {
        void route.abort();
      } else {
        void route.continue();
      }
    });
    const page = await context.newPage();
    // `networkidle` lets client-side frameworks finish hydrating and
    // fetching above-the-fold content before we snapshot the DOM.
    await page.goto(url, { waitUntil: 'networkidle', timeout: NAV_TIMEOUT_MS });
    // Re-validate the post-redirect URL against the full SSRF guard.
    const finalSafe = await checkUrlSafe(page.url());
    if (!finalSafe.ok) {
      await context.close();
      return null;
    }
    const html = await page.content();
    await context.close();
    return html;
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
