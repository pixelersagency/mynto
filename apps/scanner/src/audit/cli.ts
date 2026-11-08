/**
 * CLI runner for the full audit. Usage:
 *
 *   pnpm tsx apps/scanner/src/audit/cli.ts <url> [--format=json|md] [--out=file] [--ai[=type]]
 *
 * --ai runs the Préparation IA module too (type: auto, vitrine, contenu,
 * app_api or ecommerce; auto when omitted).
 *
 * Env vars:
 *   AUDIT_LLM_PROVIDER   gemini | mistral | anthropic   (default: gemini)
 *   AUDIT_LLM_MODEL      provider-specific              (default: gemini-2.5-flash)
 *   GEMINI_API_KEY       required if provider=gemini
 *   MISTRAL_API_KEY      required if provider=mistral
 *   ANTHROPIC_API_KEY    required if provider=anthropic
 *   AUDIT_SKIP_LLM       set to "1" to skip the LLM call (deterministic only)
 */

import { writeFile } from 'node:fs/promises';

import { AiSiteTypeInputSchema } from '@mynto/shared';

import type { LlmConfig, LlmProvider } from './llm/client.js';
import { renderMarkdownReport } from './render/markdown.js';

import { runAudit } from './index.js';

async function main(): Promise<void> {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: tsx cli.ts <url>');
    process.exit(2);
  }

  const providerRaw = process.env.AUDIT_LLM_PROVIDER as LlmProvider | undefined;
  const provider: LlmProvider = providerRaw ?? 'gemini';
  const apiKey =
    provider === 'gemini'
      ? process.env.GEMINI_API_KEY
      : provider === 'mistral'
        ? process.env.MISTRAL_API_KEY
        : process.env.ANTHROPIC_API_KEY;

  if (process.env.AUDIT_SKIP_LLM !== '1' && !apiKey) {
    console.error(
      `Missing API key for provider=${provider}. Set ${provider.toUpperCase()}_API_KEY or AUDIT_SKIP_LLM=1.`,
    );
    process.exit(2);
  }

  const defaultModel =
    provider === 'gemini'
      ? 'gemini-2.5-flash'
      : provider === 'mistral'
        ? 'mistral-large-latest'
        : 'claude-sonnet-4-6';

  const llmConfig: LlmConfig = {
    provider,
    model: process.env.AUDIT_LLM_MODEL ?? defaultModel,
    apiKey: apiKey ?? 'AUDIT_SKIP_LLM',
    temperature: 0.3,
    maxOutputTokens: 16384,
  };

  if (process.env.AUDIT_SKIP_LLM === '1') {
    // Force an invalid key so the LLM call fails fast and the pipeline falls
    // back to the deterministic skeleton.
    llmConfig.apiKey = 'invalid';
  }

  const result = await runAudit(url, llmConfig, undefined, {
    runDesignMeasurements: true,
    runLighthouse:
      process.env.AUDIT_RUN_LIGHTHOUSE === '1' || process.env.AUDIT_RUN_LIGHTHOUSE === 'true',
    runAxe: process.env.AUDIT_RUN_AXE === '1' || process.env.AUDIT_RUN_AXE === 'true',
    vision:
      process.env.AUDIT_RUN_VISION === '1' || process.env.AUDIT_RUN_VISION === 'true'
        ? process.env.VISION_LLM_PROVIDER === 'anthropic'
          ? { provider: 'anthropic' as const, apiKey: process.env.ANTHROPIC_API_KEY ?? null }
          : { apiKey: process.env.GEMINI_API_KEY ?? null }
        : undefined,
    ...aiOption(),
  });

  const format = (argv('--format') ?? 'json') as 'json' | 'md';
  const outPath = argv('--out');

  let body: string;
  if (format === 'md') {
    body = renderMarkdownReport(result.report);
  } else {
    body = JSON.stringify(
      {
        url: result.report.url,
        scannedAt: result.report.scannedAt,
        sector: result.report.sector,
        globalScore: result.report.globalScore,
        globalBand: result.report.globalBand,
        scores: result.report.scores,
        findingsBySeverity: countBy(result.report.findings, (f) => f.severity),
        findingsByAxis: countBy(result.report.findings, (f) => f.axis),
        killerFindings: result.report.killerFindings,
        top3: result.report.top3Priorities,
        quickWins: result.report.quickWins,
        // Remediation outputs
        costEstimate: result.report.costEstimate,
        remediation: result.report.remediation,
        techAge: result.report.facts.techAge,
        uiGrid: result.report.facts.vision.uiGrid,
        llmUsed: result.llmUsed,
        llmTokensIn: result.llmTokensIn,
        llmTokensOut: result.llmTokensOut,
        llmDurationMs: result.llmDurationMs,
        llmError: result.llmError,
        stack: result.report.facts.stack,
        sitemap: {
          found: result.report.facts.sitemap.found,
          foundAt: result.report.facts.sitemap.foundAt,
          urlsCount: result.report.facts.sitemap.urlsCount,
          tried: result.report.facts.sitemap.triedLocations,
        },
        errors: result.report.facts.errors,
      },
      null,
      2,
    );
  }

  if (outPath) {
    await writeFile(outPath, body, 'utf-8');
    console.error(`Wrote ${body.length.toString()} bytes to ${outPath}`);
  } else {
    process.stdout.write(`${body}\n`);
  }
}

function aiOption(): {
  aiReadiness?: {
    siteType: 'auto' | 'vitrine' | 'contenu' | 'app_api' | 'ecommerce';
    includeInGlobalScore: boolean;
  };
} {
  const flag = process.argv.slice(3).find((a) => a === '--ai' || a.startsWith('--ai='));
  if (flag === undefined) return {};
  const parsed = AiSiteTypeInputSchema.safeParse(flag.includes('=') ? flag.split('=')[1] : 'auto');
  return {
    aiReadiness: { siteType: parsed.success ? parsed.data : 'auto', includeInGlobalScore: false },
  };
}

function argv(flag: string): string | undefined {
  const prefix = `${flag}=`;
  for (const a of process.argv.slice(3)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
    if (a === flag) {
      const next = process.argv[process.argv.indexOf(a) + 1];
      if (next && !next.startsWith('--')) return next;
    }
  }
  return undefined;
}

function countBy<T>(arr: T[], fn: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of arr) {
    const k = fn(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

main().catch((err: unknown) => {
  console.error('audit_cli_fatal', (err as Error).message);
  process.exit(1);
});
