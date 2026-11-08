import { chromium, type Browser } from 'playwright';

import { MYNTO_VERSION } from '../audit/user-agent.js';
import { config } from '../config.js';

const PAGE_TIMEOUT_MS = 30_000;

/**
 * Renders the full multi-axis audit PDF by printing the web app's
 * /audit/full/[slug]/pdf page. Visual style is shared with the report page
 * so the PDF stays identical to web rendering.
 *
 * Returns null on any failure: callers treat the PDF as best-effort.
 */
export async function generateFullAuditPdf(slug: string): Promise<Buffer | null> {
  return renderPdfFromUrl(`${config.WEB_BASE_URL.replace(/\/+$/, '')}/audit/full/${slug}/pdf`);
}

async function renderPdfFromUrl(reportUrl: string): Promise<Buffer | null> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: `MyntoAudit-PDF/${MYNTO_VERSION}`,
      bypassCSP: true,
      javaScriptEnabled: true,
    });
    const page = await context.newPage();
    await page.emulateMedia({ media: 'print' });

    await page.goto(reportUrl, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });

    // Wait for web fonts to actually load. Without this, Puppeteer may
    // compute layout with fallback fonts (different metrics) → page-break
    // positions are wrong → content gets cut between pages.
    await page.evaluate(async () => {
      if ('fonts' in document) {
        await (document as Document & { fonts: { ready: Promise<void> } }).fonts.ready;
      }
    });

    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      // Zero Chrome-side margins. All spacing is controlled by @page CSS
      // (18mm 16mm). A non-zero Chrome margin paints white in that band
      // because Chrome ignores @page background — visible as a white
      // border on cream pages (cover, closing).
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    await context.close();
    return pdf;
  } catch {
    return null;
  } finally {
    if (browser !== null) {
      await browser.close().catch(() => undefined);
    }
  }
}
