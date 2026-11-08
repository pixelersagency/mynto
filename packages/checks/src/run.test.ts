import { describe, expect, it } from 'vitest';

import { evaluateAccessibilite } from './axes/accessibilite.js';
import { evaluateConformite } from './axes/conformite.js';
import { evaluateConversion } from './axes/conversion.js';
import { evaluateUi } from './axes/ui.js';
import { runChecks } from './run.js';
import { baseFacts } from './test-facts.js';
import { ALL_AXES } from './types.js';

describe('runChecks', () => {
  it('scores a clean page high across all axes', () => {
    const r = runChecks(baseFacts());
    expect(r.axes).toHaveLength(8);
    expect(r.axes.map((a) => a.axis)).toEqual([...ALL_AXES]);
    expect(r.globalScore).toBeGreaterThanOrEqual(85);
    for (const a of r.axes) expect(a.score).toBeGreaterThanOrEqual(70);
  });

  it('drops the global score when many things break', () => {
    const r = runChecks(
      baseFacts({
        title: null,
        metaDescription: null,
        h1Count: 0,
        imagesWithAlt: 2,
        imagesTotal: 10,
        legalLinks: { mentions: false, privacy: false, cgv: false, cookies: false },
        trackers: ['Google Analytics', 'Meta Pixel'],
        cookieBannerVendor: null,
        usesViewportMeta: false,
        viewportBlocksZoom: true,
      }),
    );
    expect(r.globalScore).toBeLessThan(70);
  });
});

describe('accessibilite axis', () => {
  it('fails on missing alts and blocked zoom', () => {
    const r = evaluateAccessibilite(
      baseFacts({ imagesTotal: 10, imagesWithAlt: 3, imagesEmptyAlt: 0, viewportBlocksZoom: true }),
    );
    expect(r.checks.find((c) => c.id === 'a11y.alt')?.status).toBe('fail');
    expect(r.checks.find((c) => c.id === 'a11y.zoom')?.status).toBe('fail');
    expect(r.score).toBeLessThan(70);
  });

  it('passes clean a11y', () => {
    const r = evaluateAccessibilite(baseFacts());
    expect(r.score).toBeGreaterThanOrEqual(90);
  });
});

describe('conformite axis', () => {
  it('fails trackers without consent banner', () => {
    const r = evaluateConformite(
      baseFacts({
        trackers: ['Google Analytics'],
        cookieBannerVendor: null,
        legalLinks: { mentions: true, privacy: true, cgv: true, cookies: false },
      }),
    );
    expect(r.checks.find((c) => c.id === 'legal.consent')?.status).toBe('fail');
  });
});

describe('conversion axis', () => {
  it('fails when no CTA and no contact', () => {
    const r = evaluateConversion(
      baseFacts({
        ctaButtons: 0,
        hasContactLink: false,
        hasPhoneLink: false,
        hasMailtoLink: false,
        formsCount: 0,
      }),
    );
    expect(r.checks.find((c) => c.id === 'conv.cta')?.status).toBe('fail');
    expect(r.checks.find((c) => c.id === 'conv.contact')?.status).toBe('fail');
  });
});

describe('ui axis (dated tech)', () => {
  it('flags dated stack from measurable markers', () => {
    const r = evaluateUi(
      baseFacts({ jqueryMajor: 1, layoutTables: 2, deprecatedTags: ['center'] }),
    );
    const dated = r.checks.find((c) => c.id === 'ui.dated');
    expect(dated?.status).toBe('fail');
    expect(dated?.detail).toMatch(/jQuery/);
  });

  it('passes a modern stack', () => {
    const r = evaluateUi(baseFacts());
    expect(r.checks.find((c) => c.id === 'ui.dated')?.status).toBe('pass');
  });
});
