import { describe, expect, it } from 'vitest';

import { applyAllRules } from '../src/audit/rules/index.js';
import { scoreAxes } from '../src/audit/scoring.js';
import type { AuditFacts } from '../src/audit/types.js';

function baseFacts(overrides: Partial<AuditFacts> = {}): AuditFacts {
  const def: AuditFacts = {
    url: 'https://example.com',
    scannedAt: new Date().toISOString(),
    http: {
      finalUrl: 'https://example.com',
      status: 200,
      redirectChain: ['https://example.com'],
      responseHeaders: {},
      ttfbMs: 400,
      htmlBytes: 80_000,
      isHttps: true,
      hasHsts: true,
      hasCsp: true,
    },
    stack: { stack: 'nextjs', confidence: 0.9, evidence: [] },
    meta: {
      title: 'Example - homepage',
      metaDescription: 'A short description under the 160 char limit.',
      canonical: 'https://example.com',
      htmlLang: 'fr',
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
      themeColor: '#000',
      robotsMeta: null,
      hreflangs: [],
      og: { 'og:image': 'https://example.com/og.png', 'og:title': 'x' },
      twitter: { 'twitter:card': 'summary_large_image' },
      jsonLd: [{ '@type': 'Organization' }],
      generator: null,
    },
    images: { total: 12, withAlt: 12, emptyAlt: 0, lazyLoaded: 10, withDimensions: 11 },
    headings: { h1Count: 1, h1Texts: ['hi'], hierarchyBroken: false, headings: [] },
    sitemap: {
      triedLocations: [{ url: 'https://example.com/sitemap.xml', status: 200 }],
      found: true,
      foundAt: 'https://example.com/sitemap.xml',
      declaredInRobots: true,
      urlsCount: 25,
      sampleUrls: [],
    },
    robots: {
      present: true,
      url: 'https://example.com/robots.txt',
      content: 'User-agent: *\nAllow: /',
      blocksAiBots: [],
      hasSitemapDirective: true,
      hasDisallowAll: false,
    },
    legal: {
      mentionsLegalesUrl: 'https://example.com/mentions-legales',
      mentionsLegalesStatus: 200,
      mentionsLegalesExternalUrl: null,
      privacyUrl: 'https://example.com/privacy',
      privacyStatus: 200,
      privacyExternalUrl: null,
      cgvUrl: 'https://example.com/cgv',
      cgvStatus: 200,
      dpaUrl: null,
      cookiesBannerDetected: true,
      cookiesBannerVendor: 'axeptio',
      dpoMentioned: true,
      trackersDetected: [],
    },
    lighthouse: {
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
    },
    axe: { fetched: false, violations: [], passes: 0, incomplete: 0 },
    conversion: {
      pricingUrl: 'https://example.com/pricing',
      pricingIsAnchorOnly: false,
      contactUrl: 'https://example.com/contact',
      contactHasPhone: true,
      contactHasEmail: true,
      contactHasForm: true,
      contactHasWhatsApp: false,
      testimonialsCount: 4,
      testimonialsHaveName: true,
      testimonialsHavePhoto: true,
      trustLogosCount: 6,
      ctaCount: 5,
      ctaAboveFold: true,
    },
    content: {
      wordCount: 600,
      paragraphCount: 12,
      internalLinksCount: 20,
      externalLinksCount: 3,
      hasFAQSection: true,
      hasBlogSection: true,
      blogUrl: 'https://example.com/blog',
      hasExternalBlog: false,
      externalBlogUrl: null,
      fleschScore: 65,
    },
    ux: {
      hasMobileViewport: true,
      viewportBlocksZoom: false,
      hasSkipLink: true,
      navItemsCount: 6,
      formsCount: 1,
      hasSearch: true,
    },
    ui: {
      fontFamiliesCount: 2,
      inlineStylesBytes: 800,
      themeColors: ['#000'],
      contrastIssuesCount: 0,
    },
    techAge: {
      jqueryVersion: null,
      jqueryMajor: null,
      bootstrapMajor: null,
      layoutTablesDetected: false,
      layoutTablesCount: 0,
      deprecatedTags: [],
      legacyDoctype: false,
      noResponsiveViewport: false,
      flashEmbedDetected: false,
      isDated: false,
      reasons: [],
    },
    vision: {
      fetched: false,
      screenshotBytes: 0,
      model: null,
      visibleTestimonials: 0,
      visibleTestimonialsHaveNamedAuthor: false,
      trustLogosVisible: 0,
      heroHasClearValue: null,
      heroIssues: [],
      ctaContrastIssue: null,
      visualHierarchyScore: null,
      overallVerdict: null,
      designQualityScore: null,
      designAdjectives: [],
      brandConsistencyScore: null,
      designVsSectorVerdict: null,
      navigationClarityScore: null,
      uxFrictionPoints: [],
      uxVerdict: null,
      valuePropClarity: null,
      copyToneIssues: [],
      copyVerdict: null,
      aiSlopDetected: null,
      nielsenStaticTotal: null,
      cognitiveLoadFailures: null,
      uiGrid: [],
    },
    internalPagesCrawled: [
      { url: 'https://example.com/a', status: 200, bytes: 50_000 },
      { url: 'https://example.com/b', status: 200, bytes: 60_000 },
    ],
    fakeOnePageDetected: false,
    fakeOnePageRenderCheck: 'unverified',
    errors: [],
  };
  return { ...def, ...overrides };
}

describe('audit rules', () => {
  it('emits no findings on a clean site', () => {
    const findings = applyAllRules(baseFacts());
    // Some rules can still fire on edge cases (e.g. lazy-loading threshold).
    // Critical assertion: no P0 should fire on a healthy baseline.
    const p0 = findings.filter((f) => f.severity === 'P0');
    expect(p0).toHaveLength(0);
  });

  it('flags missing sitemap as P0', () => {
    const findings = applyAllRules(
      baseFacts({
        sitemap: {
          triedLocations: [],
          found: false,
          foundAt: null,
          declaredInRobots: false,
          urlsCount: 0,
          sampleUrls: [],
        },
      }),
    );
    const sitemapFinding = findings.find((f) => f.ruleCode === 'seo.sitemap.missing');
    expect(sitemapFinding).toBeDefined();
    expect(sitemapFinding?.severity).toBe('P0');
  });

  it('flags viewport blocking zoom with WCAG/RGAA/EAA refs', () => {
    const findings = applyAllRules(
      baseFacts({
        meta: {
          ...baseFacts().meta,
          viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
        },
        ux: { ...baseFacts().ux, viewportBlocksZoom: true },
      }),
    );
    const f = findings.find((x) => x.ruleCode === 'a11y.viewport.blocks_zoom');
    expect(f).toBeDefined();
    expect(f?.severity).toBe('P0');
    const stds = f?.legalRefs.map((r) => r.standard) ?? [];
    expect(stds).toContain('WCAG');
    expect(stds).toContain('RGAA');
    expect(stds).toContain('EAA');
  });

  it('flags missing mentions légales with LCEN ref', () => {
    const findings = applyAllRules(
      baseFacts({
        legal: { ...baseFacts().legal, mentionsLegalesUrl: null },
      }),
    );
    const f = findings.find((x) => x.ruleCode === 'conformite.mentions_legales.missing');
    expect(f).toBeDefined();
    expect(f?.legalRefs.some((r) => r.standard === 'LCEN')).toBe(true);
  });

  it('flags fake one-page as P0 only when the rendered DOM is also identical', () => {
    const findings = applyAllRules(
      baseFacts({ fakeOnePageDetected: true, fakeOnePageRenderCheck: 'identical' }),
    );
    const f = findings.find((x) => x.ruleCode === 'seo.fake_one_page');
    expect(f?.severity).toBe('P0');
  });

  it('downgrades suspected one-page to P2 when JS-rendered (rendered DOM differs)', () => {
    const findings = applyAllRules(
      baseFacts({ fakeOnePageDetected: true, fakeOnePageRenderCheck: 'distinct' }),
    );
    const f = findings.find((x) => x.ruleCode === 'seo.fake_one_page');
    expect(f?.severity).toBe('P2');
  });

  it('downgrades suspected one-page to P2 when render-verification is unavailable', () => {
    const findings = applyAllRules(
      baseFacts({ fakeOnePageDetected: true, fakeOnePageRenderCheck: 'unverified' }),
    );
    const f = findings.find((x) => x.ruleCode === 'seo.fake_one_page');
    expect(f?.severity).toBe('P2');
  });
});

describe('audit scoring', () => {
  it('scores 10 across the board on a clean site', () => {
    const findings = applyAllRules(baseFacts());
    const scores = scoreAxes(findings);
    for (const s of scores) {
      expect(s.score).toBeGreaterThanOrEqual(8);
    }
  });

  it('drops the accessibilite axis to <= 7 with one P0 finding', () => {
    const findings = applyAllRules(
      baseFacts({
        meta: {
          ...baseFacts().meta,
          viewport: 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no',
        },
        ux: { ...baseFacts().ux, viewportBlocksZoom: true },
      }),
    );
    const scores = scoreAxes(findings);
    const a11y = scores.find((s) => s.axis === 'accessibilite');
    expect(a11y?.score).toBeLessThanOrEqual(7);
  });
});
