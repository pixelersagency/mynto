import { db, pgErrorCode } from '@mynto/db';
import { parseStoredModules, type AuditModules } from '@mynto/shared';
import type { Job } from 'bullmq';

import { runAudit } from '../audit/index.js';
import { collectorPlan } from '../audit/modules-plan.js';
import { axisScoresToMap, findingToRow, narrativeColumns } from '../audit/persist.js';
import { config } from '../config.js';
import { getEffectiveAiConfig } from '../lib/ai-config.js';
import { captureAndStoreFavicon } from '../lib/favicon.js';
import { captureAndStoreHero } from '../lib/hero-storage.js';
import { reserveVisionSlot } from '../lib/vision-quota.js';
import { logger } from '../logger.js';

import type { FullAuditJobData } from './full-audit-queue.js';
import { hasLlmKey, pickLlmConfig } from './llm-config.js';
import { onRadarScanCompleted } from './radar-interpret-trigger.js';

export async function processFullAudit(job: Job<FullAuditJobData>): Promise<void> {
  const { auditId, url } = job.data;
  // Radar audits (prospection) run without the narrative LLM call: the
  // narrative is deferred until Radar validates the outreach email or the
  // prospect actually opens the link.
  const radar = job.data.radar === true;
  const log = logger.child({ auditId, jobId: job.id, mode: radar ? 'radar' : 'full' });
  log.info({ url }, 'full_audit_started');

  await db().audits.update(auditId, { status: 'running', progress_step: 'loading' });
  // Favicon in parallel with the audit (dashboard identity), best-effort.
  const favicon = captureAndStoreFavicon(auditId, url).catch(() => null);
  const setStep = (step: 'analysis' | 'writing'): void => {
    void db()
      .audits.update(auditId, { progress_step: step })
      .catch(() => undefined);
  };

  // Modules stored on the row at creation (NULL = all enabled, older audits).
  const modules = await loadModules(auditId, log);
  const plan = collectorPlan(modules);
  log.info({ axes: modules.axes.length, ...plan }, 'full_audit_modules');

  // Dashboard settings first, env keys as fallback (cached ~30 s).
  const ai = await getEffectiveAiConfig();
  const llmConfig = pickLlmConfig(ai);
  const visionKey = ai.vision.apiKey;

  // Vision runs when the module is on, a key exists AND the daily quota
  // has slots left. The reserveVisionSlot() INCR happens BEFORE the
  // audit runs, so a quota-exhausted day skips vision cleanly.
  const visionEnabled = plan.vision && visionKey !== null && (await reserveVisionSlot());
  // No key for the narrative provider, or narrative module off:
  // deterministic narrative only (the pipeline's skeleton).
  const llmAvailable = hasLlmKey(ai) && modules.narrative;
  // Daily rate of the time-to-fix estimate: agency settings, then env.
  const settings = await db()
    .settings.get()
    .catch((err: unknown) => {
      log.warn({ code: pgErrorCode(err) }, 'agency_settings_read_failed');
      return null;
    });

  try {
    const result = await runAudit(
      url,
      llmConfig,
      {
        info: (o, m) => {
          log.info(o, m);
        },
        warn: (o, m) => {
          log.warn(o, m);
        },
        error: (o, m) => {
          log.error(o, m);
        },
      },
      {
        runLighthouse: config.AUDIT_RUN_LIGHTHOUSE && plan.lighthouse,
        runAxe: config.AUDIT_RUN_AXE && plan.axe,
        axes: modules.axes,
        runDesignMeasurements: plan.designMeasurements,
        // Préparation IA (optional module): deterministic probes, no LLM.
        ...(modules.ai_readiness
          ? {
              aiReadiness: {
                siteType: modules.site_type,
                includeInGlobalScore: modules.ai_in_global_score,
              },
            }
          : {}),
        // Vision stays enabled for Radar: it is capped globally by
        // VISION_DAILY_QUOTA and feeds deterministic UI/UX findings, not
        // the narrative.
        skipLlm: radar || !llmAvailable,
        onPhase: (phase) => {
          setStep(phase);
        },
        costConfig: {
          dailyRateEur: settings?.daily_rate_eur ?? config.AUDIT_DAILY_RATE_EUR,
          billableHoursPerDay: config.AUDIT_BILLABLE_HOURS_PER_DAY,
        },
        ...(visionEnabled
          ? {
              vision: {
                provider: ai.vision.provider,
                apiKey: visionKey,
                model: ai.vision.model,
              },
            }
          : {}),
      },
    );

    const r = result.report;

    const axisScoresMap = axisScoresToMap(r.scores);

    // Hero screenshot capture runs after the audit succeeds so we don't
    // waste a Playwright session on a failed scan. Best-effort — null
    // result is fine, the report just renders without the hero.
    const heroScreenshotKey = plan.hero ? await captureAndStoreHero(auditId, r.url) : null;
    const faviconKey = await favicon;

    try {
      // Final state + webhook event (audit.completed / audit.refreshed), one transaction.
      await db().audits.finish(auditId, {
        status: 'completed',
        progress_step: null,
        scanned_at: r.scannedAt,
        hero_screenshot_key: heroScreenshotKey,
        favicon_key: faviconKey,
        stack: r.facts.stack.stack,
        stack_confidence: r.facts.stack.confidence,
        global_score: r.globalScore,
        global_band: r.globalBand,
        axis_scores: axisScoresMap,
        ...narrativeColumns(r),
        cost_estimate: r.costEstimate,
        remediation: r.remediation,
        facts: r.facts,
        llm_provider: radar || !llmAvailable ? null : llmConfig.provider,
        llm_model: radar || !llmAvailable ? null : llmConfig.model,
        llm_tokens_in: result.llmTokensIn,
        llm_tokens_out: result.llmTokensOut,
        llm_duration_ms: result.llmDurationMs,
        llm_error: result.llmError ?? null,
        // What the deferred narrative needs and that only exists in memory
        // during the scan (sector hints, crawl sample, home HTML excerpt).
        ...(radar ? { llm_input: result.llmInput } : {}),
        // Only written when the module ran: with it off the row is
        // byte-for-byte the 8-axis one (ai_* stay NULL, "Non évalué").
        ...(r.aiReadiness !== undefined
          ? { ai_readiness: r.aiReadiness, ai_score: r.aiReadiness.score }
          : {}),
      });
    } catch (err) {
      const code = pgErrorCode(err) ?? 'unknown';
      log.error({ code }, 'audits_full update failed');
      throw new Error(`audits_full_update:${code}`);
    }

    if (r.findings.length > 0) {
      const rows = r.findings.map((f) => findingToRow(f, auditId));
      try {
        await db().audits.upsertFindings(rows);
      } catch (err) {
        log.error({ code: pgErrorCode(err) }, 'audit_findings_full upsert failed');
      }
    }

    log.info(
      {
        findings: r.findings.length,
        globalScore: r.globalScore,
        aiScore: r.aiReadiness?.score ?? null,
        llmUsed: result.llmUsed,
        tokensIn: result.llmTokensIn,
        tokensOut: result.llmTokensOut,
      },
      'full_audit_done',
    );

    if (radar) {
      // Interpretation requested while the scan was running: run it now.
      await onRadarScanCompleted(auditId, log);
    }
  } catch (err) {
    const message = (err as Error).message;
    log.error({ err: message }, 'full_audit_failed');
    await db()
      .audits.finish(auditId, {
        status: 'failed',
        progress_step: null,
        llm_error: message.slice(0, 500),
      })
      .catch((e: unknown) => {
        log.error({ code: pgErrorCode(e) }, 'audits_full mark_failed_failed');
      });
    throw err;
  }
}

async function loadModules(
  auditId: string,
  log: { warn: (o: object, m: string) => void },
): Promise<AuditModules> {
  try {
    return parseStoredModules(await db().audits.getModules(auditId));
  } catch (err) {
    log.warn({ code: pgErrorCode(err) }, 'audit_modules_read_failed_all_enabled');
    return parseStoredModules(null);
  }
}
