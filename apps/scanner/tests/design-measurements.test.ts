import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  collectDesignMeasurements,
  DESIGN_VIEWPORTS,
  measureDesignPage,
} from '../src/audit/collectors/design-measurements.js';
import { applyUxRules } from '../src/audit/rules/ux.js';

import { makeBaseFacts } from './helpers/base-facts.js';

describe('rendered design observations (no external network or API key)', () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser.close();
  });

  it('rejects unsafe destinations without a browser navigation', async () => {
    expect(await collectDesignMeasurements('http://127.0.0.1')).toEqual({
      fetched: false,
      viewports: [],
    });
  });

  it('measures different desktop/mobile overflow without assigning a score', async () => {
    for (const viewport of DESIGN_VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: viewport.width, height: viewport.height },
      });
      await page.setContent(
        '<style>body{margin:0}p{width:600px;font:12px/18px monospace}</style><p>Rendered text sample</p>',
      );
      const result = await measureDesignPage(page, viewport);
      expect(result.horizontalOverflowPx).toBe(viewport.viewport === 'mobile' ? 210 : 0);
      expect(result.textSamples[0]?.fontSizePx).toBe(12);
      expect(result.textSamples[0]?.lineHeightPx).toBe(18);
      expect(result.textSamples[0]?.approxCharactersPerLine).toBe(100);
      expect(result).not.toHaveProperty('score');
      const facts = {
        ...makeBaseFacts(),
        designMeasurements: { fetched: true, viewports: [result] },
      };
      const findings = applyUxRules({ facts, origin: 'https://example.com' }).filter(
        (finding) => finding.ruleCode === 'ux.layout.horizontal_overflow',
      );
      expect(findings).toHaveLength(viewport.viewport === 'mobile' ? 1 : 0);
      if (findings[0]) {
        expect(findings[0].kind).toBe('deterministic');
        expect(findings[0]).toHaveProperty('advisory', true);
      }
      await page.close();
    }
  });

  it('distinguishes crowded targets, spacing exceptions and inline links', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(
      `<style>body{margin:0}button{position:absolute;padding:0;border:0;width:16px;height:16px;top:100px}button:nth-child(1){left:0}button:nth-child(2){left:18px}button:nth-child(3){left:100px}p{margin-top:200px}a{font:12px monospace}</style><button>A</button><button>B</button><button>C</button><p>Lire <a href="#">ici</a> pour comprendre.</p>`,
    );
    const result = await measureDesignPage(page, DESIGN_VIEWPORTS[1]);
    expect(result.smallTargets.slice(0, 3).map((target) => target.spacingException)).toEqual([
      false,
      false,
      true,
    ]);
    expect(
      result.smallTargets.find((target) => target.selector.includes('a:'))?.inlineException,
    ).toBe(true);
    const facts = {
      ...makeBaseFacts(),
      designMeasurements: { fetched: true, viewports: [result] },
    };
    const finding = applyUxRules({ facts, origin: 'https://example.com' }).find(
      (item) => item.ruleCode === 'ux.targets.small_crowded',
    );
    expect(finding?.evidence.targets).toHaveLength(2);
    const truncatedFacts = {
      ...facts,
      designMeasurements: {
        ...facts.designMeasurements,
        viewports: [{ ...result, truncated: true }],
      },
    };
    expect(
      applyUxRules({ facts: truncatedFacts, origin: 'https://example.com' }).some(
        (item) => item.ruleCode === 'ux.targets.small_crowded',
      ),
    ).toBe(false);
    await page.close();
  });

  it('records overflowing rendered text lines, excludes hidden targets and bounds output', async () => {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.setContent(
      '<style>body{margin:0}p{width:50px;white-space:nowrap}button{display:none}</style><p>' +
        'overflow '.repeat(100) +
        '</p><button>hidden</button>' +
        '<p>sample</p>'.repeat(80),
    );
    const result = await measureDesignPage(page, DESIGN_VIEWPORTS[1]);
    expect(result.overflowElements.some((el) => el.right > 390)).toBe(true);
    expect(result.smallTargets).toHaveLength(0);
    expect(result.textSamples.length).toBeLessThanOrEqual(50);
    expect(result.truncated).toBe(true);
    await page.close();
  });
});

// Import the collector in a fresh Node process: Vitest's transform does not
// reproduce tsx/esbuild keepNames helpers inside serialized browser callbacks.
it('measures both viewports through the production Node TSX runtime', async () => {
  const { stdout } = await promisify(execFile)(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
      import assert from 'node:assert/strict';
      import { chromium } from 'playwright';
      import { DESIGN_VIEWPORTS, measureDesignPage } from './src/audit/collectors/design-measurements.ts';
      const browser = await chromium.launch({ headless: true });
      try {
        const results = [];
        for (const viewport of DESIGN_VIEWPORTS) {
          const context = await browser.newContext({
            viewport: { width: viewport.width, height: viewport.height },
            offline: true,
            serviceWorkers: 'block',
          });
          try {
            await context.route('**/*', route => route.abort());
            const page = await context.newPage();
            await page.setContent('<style>body{margin:0}p{width:600px;font:12px/18px monospace}button{padding:0;border:0;width:16px;height:16px}</style><p>Rendered sample</p><button>A</button><button>B</button>');
            assert.equal(await page.evaluate('typeof globalThis.__name'), 'undefined');
            const result = await measureDesignPage(page, viewport);
            assert.equal(await page.evaluate('typeof globalThis.__name'), 'undefined');
            results.push(result);
          } finally {
            await context.close();
          }
        }
        console.log(JSON.stringify(results));
      } finally {
        await browser.close();
      }
    `,
    ],
    { cwd: new URL('..', import.meta.url), timeout: 30_000 },
  );
  const results: unknown = JSON.parse(stdout);
  expect(results).toEqual(
    DESIGN_VIEWPORTS.map((viewport): unknown =>
      expect.objectContaining({
        ...viewport,
        horizontalOverflowPx: viewport.viewport === 'mobile' ? 210 : 0,
        textSamples: [
          expect.objectContaining({
            fontSizePx: 12,
            lineHeightPx: 18,
            approxCharactersPerLine: 100,
          }),
        ],
        smallTargets: [
          expect.objectContaining({ width: 16, height: 16, spacingException: false }),
          expect.objectContaining({ width: 16, height: 16, spacingException: false }),
        ],
        truncated: false,
      }),
    ),
  );
}, 40_000);
