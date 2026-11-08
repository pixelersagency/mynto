import { chromium, type Browser } from 'playwright';

import { checkUrlSafe } from '../../lib/url-guard.js';
import { auditUserAgent } from '../user-agent.js';

import { isBlockedRequestUrl } from './safe-fetch.js';

const PAGE_TIMEOUT_MS = 20_000;

/**
 * Re-check a suspected fake one-page against the JavaScript-rendered DOM.
 *
 * `fetchInternalSample` flags `fakeOnePage` when the *raw* HTML of every
 * sampled page is byte-identical to the home page. That is not proof: a
 * JS-rendered site (SPA, headless CMS, real-estate platforms like
 * la-boite-immo) legitimately ships the same raw shell on every URL and
 * injects the unique content client-side.
 *
 * This collector renders the home page and one sample page with a real
 * browser and compares the visible text. If they differ, the site is merely
 * JS-rendered and the P0 "fake one-page" verdict must be downgraded.
 *
 * Best-effort: any failure returns `unverified` and never throws.
 */
export async function verifyOnePageRender(
  homeUrl: string,
  sampleUrl: string,
): Promise<'distinct' | 'identical' | 'unverified'> {
  if (homeUrl === sampleUrl) return 'unverified';
  for (const u of [homeUrl, sampleUrl]) {
    const safe = await checkUrlSafe(u);
    if (!safe.ok) return 'unverified';
  }

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: auditUserAgent() });
    // Block navigation redirects + subresources to private IPs / internal
    // hostnames — the audited site must not pull the browser inward.
    await context.route('**/*', (route) => {
      if (isBlockedRequestUrl(route.request().url())) {
        void route.abort();
      } else {
        void route.continue();
      }
    });

    const [home, sample] = await Promise.all([
      renderedText(context, homeUrl),
      renderedText(context, sampleUrl),
    ]);

    await context.close();

    if (home === null || sample === null) return 'unverified';
    return home === sample ? 'identical' : 'distinct';
  } catch {
    return 'unverified';
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

/** Load a URL with JS executed and return a normalized visible-text fingerprint. */
async function renderedText(
  context: Awaited<ReturnType<Browser['newContext']>>,
  url: string,
): Promise<string | null> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });
    // Reject a navigation that redirected onto an unsafe host.
    const finalSafe = await checkUrlSafe(page.url());
    if (!finalSafe.ok) return null;
    const text = await page.evaluate(() => document.body.innerText);
    return text.replace(/\s+/g, ' ').trim();
  } catch {
    return null;
  } finally {
    await page.close().catch(() => undefined);
  }
}
