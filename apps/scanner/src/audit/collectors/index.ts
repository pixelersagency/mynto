import * as cheerio from 'cheerio';

import type {
  AuditFacts,
  AxeFacts,
  LighthouseFacts,
  SectorContext,
  VisionFacts,
} from '../types.js';

import { runAxe } from './axe.js';
import { extractContent, extractUi, extractUx } from './content.js';
import { collectConversion } from './conversion.js';
import { fetchInternalSample } from './crawl.js';
import { collectDesignMeasurements } from './design-measurements.js';
import { probeUrl, AUDIT_USER_AGENT } from './http.js';
import { collectLegal } from './legal.js';
import { runLighthouse } from './lighthouse.js';
import { extractHeadings, extractImages, extractMeta } from './meta.js';
import { renderHtml } from './render-html.js';
import { fetchRobots } from './robots.js';
import { discoverSitemap } from './sitemap-discovery.js';
import { detectStack } from './stack-detect.js';
import { detectTechAge } from './tech-age.js';
import { verifyOnePageRender } from './verify-one-page.js';
import { collectVision } from './vision.js';

export interface CollectAllOptions {
  runLighthouse?: boolean;
  runAxe?: boolean;
  /** Rendered viewport observations, without an LLM. */
  runDesignMeasurements?: boolean;
  /**
   * Vision LLM pipeline. Disabled when omitted or when apiKey is
   * absent. Fully best-effort : a failure inside the vision call never
   * fails the whole audit and never throws.
   */
  vision?: { provider?: 'gemini' | 'anthropic'; apiKey: string | null; model?: string };
}

interface CollectorErrors {
  errors: { phase: string; message: string }[];
}

/**
 * Run all deterministic collectors against a target URL and assemble facts.
 * Lighthouse + axe-core are optional and currently stubbed; the LLM step
 * works without them, just with lower SEO/perf/a11y signal.
 */
export async function collectAll(
  url: string,
  opts: CollectAllOptions = {},
): Promise<{
  facts: AuditFacts;
  homeHtml: string;
  $: cheerio.CheerioAPI;
}> {
  const errors: CollectorErrors['errors'] = [];

  const probe = await probeUrl(url).catch((e: unknown) => {
    throw new Error(`http_probe_failed:${e instanceof Error ? e.message : String(e)}`);
  });

  // `html` is the raw, pre-JavaScript document — kept for HTTP facts, stack
  // detection and the fake-one-page fingerprint (which must compare raw to
  // raw). `domHtml` is the JS-rendered DOM, the way Googlebot sees the page;
  // every cheerio collector below runs on it so JS-rendered sites stop
  // producing false positives (thin content, missing nav/H1/JSON-LD...).
  const html = probe.html;
  const renderedHtml = await renderHtml(probe.facts.finalUrl).catch((e: unknown) => {
    errors.push({ phase: 'render', message: (e as Error).message });
    return null;
  });
  if (!renderedHtml) {
    errors.push({ phase: 'render', message: 'render_unavailable_fell_back_to_raw_html' });
  }
  const domHtml = renderedHtml ?? html;
  const $ = cheerio.load(domHtml);
  const meta = extractMeta($);

  const stack = detectStack({
    html,
    responseHeaders: probe.facts.responseHeaders,
    generatorMeta: meta.generator,
  });

  const origin = (() => {
    try {
      return new URL(probe.facts.finalUrl).origin;
    } catch {
      return new URL(url).origin;
    }
  })();

  const knownLinks = collectAllHrefs($, origin);

  const [robots, internalPages] = await Promise.all([
    fetchRobots(origin, AUDIT_USER_AGENT).catch((e: unknown) => {
      errors.push({ phase: 'robots', message: (e as Error).message });
      return null;
    }),
    fetchInternalSample(origin, $, html).catch((e: unknown) => {
      errors.push({ phase: 'crawl_sample', message: (e as Error).message });
      return [];
    }),
  ]);

  const fakeOnePageDetected =
    Boolean((internalPages as { fakeOnePage?: boolean }).fakeOnePage) && internalPages.length >= 2;

  // A raw-HTML duplicate is only suspicious until proven: re-check the
  // JS-rendered DOM before letting the rule emit a P0. JS-rendered sites ship
  // an identical raw shell on every URL, which is not a fake one-page.
  let fakeOnePageRenderCheck: 'distinct' | 'identical' | 'unverified' = 'unverified';
  if (fakeOnePageDetected) {
    const sampleUrl = internalPages[0]?.url;
    if (sampleUrl) {
      fakeOnePageRenderCheck = await verifyOnePageRender(probe.facts.finalUrl, sampleUrl).catch(
        (e: unknown) => {
          errors.push({ phase: 'one_page_verify', message: (e as Error).message });
          return 'unverified' as const;
        },
      );
    }
  }

  const sitemap = await discoverSitemap(origin, {
    knownLinks,
    stack: stack.stack === 'unknown' ? undefined : stack.stack,
    userAgent: AUDIT_USER_AGENT,
  }).catch((e: unknown) => {
    errors.push({ phase: 'sitemap', message: (e as Error).message });
    return {
      triedLocations: [],
      found: false,
      foundAt: null,
      declaredInRobots: false,
      urlsCount: 0,
      sampleUrls: [],
    };
  });

  const legal = await collectLegal(origin, domHtml, {
    userAgent: AUDIT_USER_AGENT,
    stack: stack.stack === 'unknown' ? undefined : stack.stack,
    knownLinks,
  }).catch((e: unknown) => {
    errors.push({ phase: 'legal', message: (e as Error).message });
    return {
      mentionsLegalesUrl: null,
      mentionsLegalesStatus: null,
      mentionsLegalesExternalUrl: null,
      privacyUrl: null,
      privacyStatus: null,
      privacyExternalUrl: null,
      cgvUrl: null,
      cgvStatus: null,
      dpaUrl: null,
      cookiesBannerDetected: false,
      cookiesBannerVendor: null,
      dpoMentioned: null,
      trackersDetected: [],
    };
  });

  const conversion = await collectConversion(origin, $, {
    userAgent: AUDIT_USER_AGENT,
    stack: stack.stack === 'unknown' ? undefined : stack.stack,
    knownLinks,
  }).catch((e: unknown) => {
    errors.push({ phase: 'conversion', message: (e as Error).message });
    return {
      pricingUrl: null,
      pricingIsAnchorOnly: false,
      contactUrl: null,
      contactHasPhone: false,
      contactHasEmail: false,
      contactHasForm: false,
      contactHasWhatsApp: false,
      testimonialsCount: 0,
      testimonialsHaveName: false,
      testimonialsHavePhoto: false,
      trustLogosCount: 0,
      ctaCount: 0,
      ctaAboveFold: false,
    };
  });

  const blogUrlHint =
    $('a[href*="/blog"], a[href*="/articles"], a[href*="/actualit"]').first().attr('href') ?? null;
  const blogUrlResolved = blogUrlHint ? safeResolve(blogUrlHint, origin) : null;

  const content = extractContent($, blogUrlResolved, origin);
  const ux = extractUx($);
  const ui = extractUi($);
  // Dated-tech signals are read from the RAW served HTML (not the rendered
  // DOM) so legacy markers in the original document aren't masked by a
  // client-side framework. Code concludes "dated", never the vision LLM.
  const techAge = detectTechAge({ rawHtml: html, hasMobileViewport: ux.hasMobileViewport });
  const images = extractImages($);
  const headings = extractHeadings($);

  // Heavy collectors run sequentially to limit RAM on constrained workers.
  // Each one returns its fallback `fetched: false` shape on any internal error.
  let lighthouse: LighthouseFacts = {
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
  if (opts.runLighthouse) {
    lighthouse = await runLighthouse(probe.facts.finalUrl).catch(() => {
      errors.push({ phase: 'lighthouse', message: 'lighthouse_exception' });
      return lighthouse;
    });
  }

  if (!lighthouse.fetched || lighthouse.performance === null) {
    if (!errors.some((e) => e.phase === 'lighthouse')) {
      errors.push({
        phase: 'lighthouse',
        message: opts.runLighthouse
          ? (lighthouse.errorCode ?? 'lighthouse_performance_unavailable')
          : 'lighthouse_disabled',
      });
    }
  }

  let axe: AxeFacts = {
    fetched: false,
    violations: [],
    passes: 0,
    incomplete: 0,
  };
  if (opts.runAxe) {
    axe = await runAxe(probe.facts.finalUrl).catch(() => {
      errors.push({ phase: 'axe', message: 'axe_exception' });
      return axe;
    });
  }

  if (!axe.fetched && !errors.some((e) => e.phase === 'axe')) {
    errors.push({ phase: 'axe', message: opts.runAxe ? 'axe_unavailable' : 'axe_disabled' });
  }

  // Vision LLM is the heaviest collector (Playwright + Gemini call). Run
  // last so a vision-pipeline timeout cannot starve cheaper data.
  let vision: VisionFacts = {
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
  };
  if (opts.vision?.apiKey) {
    // Pre-compute a sector hint from the visible text so the vision
    // prompt can compare the design / copy against the sector's typical
    // bar. The official sector detection happens later in the pipeline
    // (it folds the LLM narrative back in) ; this preliminary hint is
    // close enough for the design-vs-sector verdict.
    const homeText = $.root().text();
    const sectorHintEarly =
      deriveSectorHints({
        facts: {} as AuditFacts,
        homeText,
      }).detected ?? null;

    vision = await collectVision(probe.facts.finalUrl, {
      ...(opts.vision.provider ? { provider: opts.vision.provider } : {}),
      apiKey: opts.vision.apiKey,
      ...(opts.vision.model ? { model: opts.vision.model } : {}),
      sectorHint: sectorHintEarly,
    }).catch(() => {
      errors.push({ phase: 'vision', message: 'vision_exception' });
      return vision;
    });
  }

  if (!vision.fetched && !errors.some((e) => e.phase === 'vision')) {
    errors.push({
      phase: 'vision',
      message: !opts.vision?.apiKey
        ? 'vision_disabled_or_unconfigured'
        : vision.screenshotBytes === 0
          ? 'vision_capture_unavailable'
          : 'vision_response_unavailable',
    });
  }

  const designMeasurements = opts.runDesignMeasurements
    ? await collectDesignMeasurements(probe.facts.finalUrl).catch(() => ({
        fetched: false,
        viewports: [],
      }))
    : undefined;
  if (designMeasurements && !designMeasurements.fetched) {
    errors.push({ phase: 'design_measurements', message: 'design_measurements_incomplete' });
  }

  const facts: AuditFacts = {
    url,
    scannedAt: new Date().toISOString(),
    http: probe.facts,
    stack,
    meta,
    images,
    headings,
    sitemap,
    robots: robots ?? {
      present: false,
      url: `${origin}/robots.txt`,
      content: null,
      blocksAiBots: [],
      hasSitemapDirective: false,
      hasDisallowAll: false,
    },
    legal,
    lighthouse,
    axe,
    conversion,
    content,
    ux,
    ui,
    techAge,
    vision,
    ...(designMeasurements ? { designMeasurements } : {}),
    internalPagesCrawled: internalPages,
    fakeOnePageDetected,
    fakeOnePageRenderCheck,
    errors,
  };

  return { facts, homeHtml: domHtml, $ };
}

function collectAllHrefs($: cheerio.CheerioAPI, origin: string): string[] {
  const out: string[] = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    try {
      const u = new URL(href, origin);
      if (u.origin === origin) out.push(u.toString());
    } catch {
      // skip
    }
  });
  return out;
}

function safeResolve(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

export interface SectorHintInput {
  facts: AuditFacts;
  homeText: string;
}

/**
 * Local heuristic for sector signals. The LLM step finalises detection,
 * but we provide first-pass hints so the audit still ships a usable
 * sector even if the LLM call fails.
 */
export function deriveSectorHints(input: SectorHintInput): Partial<SectorContext> {
  const text = input.homeText.toLowerCase();
  const keywords = [
    {
      sector: 'formation',
      kpi: 'demandes de devis',
      re: /\b(formation|opco|cpf|qualiopi|inter[-_ ]?entreprise|intra[-_ ]?entreprise)\b/,
    },
    {
      sector: 'e-commerce',
      kpi: 'conversions panier',
      re: /\b(panier|commander|ajouter au panier|checkout|livraison|stock)\b/,
    },
    {
      sector: 'cosmétique',
      kpi: 'conversions',
      re: /\b(creme|sérum|hydratant|skincare|cosm[ée]tique|maquillage|cheveux)\b/,
    },
    {
      sector: 'immobilier',
      kpi: "demandes d'estimation",
      re: /\b(immobili[eè]r|appartement|maison|estimation|location|vente|mandat)\b/,
    },
    {
      sector: 'recrutement',
      kpi: 'candidatures',
      re: /\b(recrutement|emploi|carri[èe]res?|candidature|offre d'emploi|jobs?)\b/,
    },
    {
      sector: 'saas b2b',
      kpi: 'démos bookées',
      re: /\b(saas|essai gratuit|free trial|d[ée]mo|api|dashboard|tableau de bord)\b/,
    },
    {
      sector: 'services pro',
      kpi: 'prises de RDV',
      re: /\b(avocat|notaire|expert[- ]?comptable|conseil|cabinet|honoraire)\b/,
    },
    {
      sector: 'restauration',
      kpi: 'réservations',
      re: /\b(restaurant|menu|r[ée]server|chef|cuisine|carte des vins)\b/,
    },
    {
      sector: 'marketplace',
      kpi: 'premières transactions',
      re: /\b(marketplace|vendeur|acheteur|commission|plateforme)\b/,
    },
  ];

  let best: { sector: string; kpi: string; score: number } = {
    sector: 'générique',
    kpi: 'conversions',
    score: 0,
  };
  for (const k of keywords) {
    const matches = text.match(new RegExp(k.re.source, 'gi'));
    const score = matches?.length ?? 0;
    if (score > best.score) {
      best = { sector: k.sector, kpi: k.kpi, score };
    }
  }

  return {
    detected: best.sector,
    confidence: best.score > 3 ? 0.7 : best.score > 0 ? 0.4 : 0.1,
    mainKpi: best.kpi,
    secondaryKpi: 'trafic organique',
    audienceNotes: '',
  };
}
