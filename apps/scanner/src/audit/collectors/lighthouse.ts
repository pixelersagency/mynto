import * as ChromeLauncher from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { chromium } from 'playwright';

import { logger } from '../../logger.js';
import type { LighthouseFacts } from '../types.js';

const LIGHTHOUSE_TIMEOUT_MS = 60_000;

/**
 * Path to the Chromium binary Playwright ships. chrome-launcher's default
 * discovery looks for a system Chrome install (apt, snap, .app on macOS)
 * which is absent from the scanner image: Playwright is the only
 * Chromium present. Resolved lazily so import order doesn't matter, and
 * cached because the path doesn't change at runtime.
 */
let cachedChromePath: string | null = null;
function getChromePath(): string | null {
  if (cachedChromePath !== null) return cachedChromePath;
  try {
    cachedChromePath = chromium.executablePath();
    return cachedChromePath;
  } catch {
    return null;
  }
}

/**
 * Run Lighthouse against a URL using a headless Chrome instance.
 *
 * RAM-heavy: a Lighthouse run + headless Chrome is roughly 400-600MB.
 * With worker concurrency=2 we get a peak around 1.2 GB,
 * which is fine but stacks with the Playwright PDF run later, so we
 * shut Chrome down aggressively in `finally`.
 *
 * Returns `fetched: false` on any failure — never throws to the caller.
 * The pipeline degrades gracefully when Lighthouse data is missing.
 */
export async function runLighthouse(url: string): Promise<LighthouseFacts> {
  const empty: LighthouseFacts = {
    fetched: false,
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
    lcpMs: null,
    clsScore: null,
    inpMs: null,
    tbtMs: null,
    totalByteWeight: null,
  };

  let chrome: ChromeLauncher.LaunchedChrome | null = null;
  const deadline = Date.now() + LIGHTHOUSE_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('lighthouse_timeout'));
    }, LIGHTHOUSE_TIMEOUT_MS);
  });
  try {
    const chromePath = getChromePath();
    const launch = ChromeLauncher.launch({
      chromeFlags: ['--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage'],
      maxConnectionRetries: 3,
      // chromePath is undefined on hosts where Playwright is unavailable
      // (which would be a build problem) ; chrome-launcher then falls
      // back to its default Chrome discovery.
      ...(chromePath ? { chromePath } : {}),
    });
    // If launch completes after the outer deadline, it still owns a Chrome
    // process: reap it even though the caller has already received fallback.
    void launch.then(
      (launched) => {
        if (Date.now() >= deadline) {
          try {
            launched.kill();
          } catch {
            /* already exited */
          }
        }
      },
      () => undefined,
    );
    chrome = await Promise.race([launch, timeout]);
    if (Date.now() > deadline) return { ...empty, errorCode: 'lighthouse_launch_timeout' };

    const result = await Promise.race([
      lighthouse(url, {
        port: chrome.port,
        output: 'json',
        logLevel: 'silent',
        maxWaitForLoad: Math.max(5_000, deadline - Date.now()),
        // Mobile preset matches what users see in PageSpeed Insights; SaaS
        // audiences usually browse from desktop but mobile is the stricter
        // bar so we report against it.
        formFactor: 'mobile',
        screenEmulation: {
          mobile: true,
          width: 412,
          height: 823,
          deviceScaleFactor: 1.75,
          disabled: false,
        },
        throttling: {
          cpuSlowdownMultiplier: 4,
          rttMs: 150,
          throughputKbps: 1638.4,
          requestLatencyMs: 562.5,
          downloadThroughputKbps: 1474.56,
          uploadThroughputKbps: 675,
        },
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      }),
      timeout,
    ]);

    if (!result?.lhr) return { ...empty, errorCode: 'lighthouse_no_report' };
    const lhr = result.lhr;

    // Lighthouse often returns a report with runtimeError instead of throwing.
    // Never treat that report as a successful measurement.
    if (lhr.runtimeError) {
      const code = lhr.runtimeError.code;
      return {
        ...empty,
        errorCode: /^[A-Z_]{1,80}$/.test(code)
          ? `lighthouse_runtime_${code}`
          : 'lighthouse_runtime_error',
      };
    }

    const cat = lhr.categories;
    const audits = lhr.audits;

    return {
      fetched: true,
      performance: categoryScore(cat.performance?.score),
      ...(categoryScore(cat.performance?.score) === null
        ? { errorCode: 'lighthouse_performance_unavailable' }
        : {}),
      accessibility: cat.accessibility?.score ?? null,
      bestPractices: cat['best-practices']?.score ?? null,
      seo: cat.seo?.score ?? null,
      lcpMs: numericValue(audits['largest-contentful-paint']?.numericValue),
      clsScore: numericValue(audits['cumulative-layout-shift']?.numericValue),
      inpMs: numericValue(audits['interaction-to-next-paint']?.numericValue),
      tbtMs: numericValue(audits['total-blocking-time']?.numericValue),
      totalByteWeight: numericValue(audits['total-byte-weight']?.numericValue),
    };
  } catch {
    // Surface the underlying reason in the worker logs. Until this catch
    // logged, every "perf.*" rule appeared as "Non exécutés" with no way
    // to know why from the audit report alone.
    logger.warn(
      { code: Date.now() >= deadline ? 'lighthouse_timeout' : 'lighthouse_exception' },
      'lighthouse_run_failed',
    );
    return {
      ...empty,
      errorCode: Date.now() >= deadline ? 'lighthouse_timeout' : 'lighthouse_exception',
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (chrome !== null) {
      try {
        // chrome-launcher kill() is synchronous and SIGKILLs the process group.
        chrome.kill();
      } catch {
        // chrome already exited
      }
    }
  }
}

function numericValue(v: number | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function categoryScore(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}
