import { AxeBuilder } from '@axe-core/playwright';
import { chromium, type Browser } from 'playwright';

import { checkUrlSafe } from '../../lib/url-guard.js';
import type { AxeFacts } from '../types.js';
import { auditUserAgent } from '../user-agent.js';

const PAGE_TIMEOUT_MS = 30_000;
const ANALYZE_TIMEOUT_MS = 30_000;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

interface AxeViolation {
  id: string;
  impact: 'critical' | 'serious' | 'moderate' | 'minor' | null;
  description: string;
  helpUrl: string;
  nodes: { target: string[]; html: string; failureSummary?: string }[];
}

interface AxeResults {
  violations: AxeViolation[];
  passes: { id: string }[];
  incomplete: { id: string }[];
}

/**
 * Headless axe-core run on the home page (single-page only for the full
 * audit — the legacy a11y scanner already does multi-page).
 *
 * Returns `fetched: false` on any failure. Sequential with Lighthouse to
 * avoid running two browsers at the same time on constrained workers.
 */
export async function runAxe(url: string): Promise<AxeFacts> {
  const empty: AxeFacts = { fetched: false, violations: [], passes: 0, incomplete: 0 };

  const safe = await checkUrlSafe(url);
  if (!safe.ok) return empty;

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: auditUserAgent(),
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: PAGE_TIMEOUT_MS });

    const axe = new AxeBuilder({ page }).withTags(AXE_TAGS);
    const results = (await Promise.race([
      axe.analyze(),
      new Promise<never>((_, reject) =>
        setTimeout(() => {
          reject(new Error('axe_timeout'));
        }, ANALYZE_TIMEOUT_MS),
      ),
    ])) as AxeResults;

    await context.close();

    return {
      fetched: true,
      violations: results.violations.map((v) => ({
        ruleId: v.id,
        impact: v.impact ?? 'minor',
        description: v.description,
        helpUrl: v.helpUrl,
        nodes: v.nodes.length,
      })),
      passes: results.passes.length,
      incomplete: results.incomplete.length,
    };
  } catch {
    return empty;
  } finally {
    if (browser !== null) {
      await browser.close().catch(() => undefined);
    }
  }
}
