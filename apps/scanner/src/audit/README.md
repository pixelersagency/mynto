# Mynto Full Audit Pipeline

Multi-axis website audit producing a French consultant-grade Markdown/PDF report. Replaces the a11y-only scanner output with the full 8-axis audit described in `site-audit` skill.

## Architecture

```
URL
 │
 ▼
[1] COLLECT (deterministic, parallel)
 ├─ http.ts          HTTP probe, redirects, security headers, TTFB
 ├─ crawl.ts         Playwright render + 5 internal pages (BFS)
 ├─ meta.ts          title, meta, OG, Twitter, JSON-LD, hreflangs, generator
 ├─ images.ts        alt coverage, lazy-loading, dimensions
 ├─ headings.ts      H1 count, hierarchy
 ├─ stack-detect.ts  WP / Shopify / Next / Webflow / Framer / Wix / Astro / ...
 ├─ resilient-paths.ts  multi-stack, multi-language path discovery
 ├─ sitemap-discovery.ts  robots Sitemap: directive → stack-specific → fallback
 ├─ robots.ts        robots.txt parse, AI bot blocks, Disallow checks
 ├─ legal.ts         mentions, privacy, CGV, cookies banner vendor, trackers
 ├─ lighthouse.ts    Lighthouse mobile 4G slow (perf, a11y, bp, seo)
 ├─ axe.ts           axe-core run via @axe-core/playwright
 ├─ conversion.ts    pricing, contact, testimonials, CTA, trust signals
 ├─ content.ts       word count, links, Flesch readability (FR)
 ├─ ux.ts            viewport, skip-link, nav, forms
 └─ ui.ts            inline styles weight, fonts, contrast issues count
        │
        ▼
[2] RULES (deterministic, axis files)
 ├─ rules/seo-technique.ts
 ├─ rules/seo-contenu.ts
 ├─ rules/performance.ts
 ├─ rules/accessibilite.ts
 ├─ rules/conformite.ts
 ├─ rules/conversion.ts
 ├─ rules/ui.ts
 └─ rules/ux.ts
        │
        ▼
[3] SCORE (deterministic)
 scoring.ts: per-axis 0-10, global = weighted average
        │
        ▼
[4] LLM BATCH (single call)
 llm/client.ts
   - Gemini 2.5 Flash by default (1M context, $0.075/M in, $0.30/M out)
   - Mistral Large fallback
   - Claude Sonnet for Pro tier
 llm/prompts.ts    grounded in site-audit skill (8 axes, FR consultant tone)
 llm/output-schema.ts  Zod strict + cross-check finding ids
        │
        ▼
[5] ASSEMBLE
 pipeline.ts: merge LLM narrative into deterministic findings
        │
        ▼
[6] RENDER
 render/markdown.ts  template aligned with site-audit/output-template.md
 render/pdf.ts       Puppeteer print or reuse existing react-pdf path
```

## Why this shape

- **Deterministic detection, LLM narrative only.** The LLM never invents findings, never modifies scores or legal refs. Hallucination on a WCAG/RGAA citation would be a reputational hit, so those references are looked up by deterministic rule code → ref table.
- **Resilient path discovery.** A sitemap is not always at `/sitemap.xml` — WordPress exposes `/wp-sitemap.xml`, Shopify splits into `/sitemap_products_1.xml`, Yoast/RankMath use `/sitemap_index.xml`. The same logic applies to `/mentions-legales` vs `/legal-notice` vs `/impressum`, `/pricing` vs `/tarifs`, etc. Each category has a stack-aware ordered candidate list, checked HEAD-first.
- **Single batch LLM call.** Gemini 2.5 Flash's 1M context window lets us pass facts + findings + scores + home HTML in one shot. Cheaper than per-axis calls, faster, and the model sees the whole picture for cross-axis reasoning.
- **Provider swap, not code change.** `LlmConfig` lets the operator pick provider per audit tier (free / Pro / premium) without rewriting the pipeline.

## Cost envelope (per audit)

| Tier    | Provider  | Model                  | Estimated cost                      |
| ------- | --------- | ---------------------- | ----------------------------------- |
| Free    | Gemini    | `gemini-2.5-flash`     | ~$0.10 (or free under 1500 req/day) |
| Pro     | Mistral   | `mistral-large-latest` | ~$0.20                              |
| Premium | Anthropic | `claude-sonnet-4-6`    | ~$0.50                              |

## What is intentionally NOT here yet

- `collectors/crawl.ts`, `meta.ts`, `lighthouse.ts`, `axe.ts`, `conversion.ts`, `content.ts`, `ux.ts`, `ui.ts`, `legal.ts`, `robots.ts`, `images.ts`, `headings.ts` — to be added next sprint, signatures defined in `types.ts`.
- `rules/*.ts` — to be added with seed rules per axis. Convention: each rule reads from `AuditFacts`, emits `Finding[]`, declares its `LegalRef[]` inline.
- `scoring.ts` — weighted average per axis. Weights: SEO 1.2, perf 1.0, a11y 1.0, conformité 1.0, conversion 1.2, UX 0.8, UI 0.6, contenu 0.8 (tunable).
- DB migration for `audits_full`, `audit_findings`, `audit_rules`, `sector_benchmarks`.

## Running it (once collectors land)

```ts
import { runFullAudit } from './audit/pipeline.js';

const result = await runFullAudit('https://example.com', {
  collect,
  applyRules,
  scoreAxes,
  deriveSectorHints,
  pickInternalSample,
  pickHomeHtmlExcerpt,
  llmConfig: {
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    apiKey: process.env.GEMINI_API_KEY!,
    temperature: 0.3,
  },
  logger,
});
```

## Hardening checklist (before MVP ship)

- [ ] All collectors implemented + unit tests on fixtures
- [ ] Rules emit `LegalRef[]` only from a whitelisted enum (no LLM citations)
- [ ] LLM output Zod schema enforced in CI with sample fixtures
- [ ] Migration with RLS on every new table (CLAUDE.md non-negotiable)
- [ ] `pnpm typecheck` clean
- [ ] Playwright concurrency limited so Lighthouse + axe don't fight for RAM on a small (8 GB) worker
