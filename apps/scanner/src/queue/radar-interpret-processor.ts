import { db, pgErrorCode, type AuditInterpretRow } from '@mynto/db';
import { parseStoredAiReadiness, parseStoredModules } from '@mynto/shared';
import type { Job } from 'bullmq';

import { runAuditLlm } from '../audit/llm/client.js';
import {
  applyFindingNarratives,
  buildNarrativeFields,
  computeGlobalScore,
} from '../audit/narrative.js';
import { findingToRow, narrativeColumns } from '../audit/persist.js';
import { aiGlobalScoreEntry } from '../audit/pipeline.js';
import { getEffectiveAiConfig } from '../lib/ai-config.js';
import { rebuildRunInput } from '../lib/radar/rebuild.js';
import { logger } from '../logger.js';

import { hasLlmKey, pickLlmConfig } from './llm-config.js';
import type { RadarInterpretJobData } from './radar-interpret-queue.js';

/**
 * Deferred narrative for a Radar audit. Rebuilds the LLM input from the
 * persisted scan, runs the same single batch call as the synchronous
 * pipeline, then applies it with the same shared code (audit/narrative.ts).
 *
 * Idempotent: anything other than `llm_status = 'pending'` on a completed
 * scan is a no-op, and the final write is conditional on `pending`.
 */
export async function processRadarInterpret(job: Job<RadarInterpretJobData>): Promise<void> {
  const { auditId } = job.data;
  const log = logger.child({ auditId, jobId: job.id, queue: 'radar-interpret' });

  let audit: AuditInterpretRow | null;
  try {
    audit = await db().audits.getForInterpret(auditId);
  } catch (err) {
    log.error({ code: pgErrorCode(err) }, 'radar_interpret_audit_lookup_failed');
    throw new Error('radar_interpret_lookup_failed');
  }
  if (audit === null) {
    log.warn('radar_interpret_audit_gone');
    return;
  }
  if (audit.llm_status !== 'pending' || audit.status !== 'completed') {
    log.info({ llmStatus: audit.llm_status, status: audit.status }, 'radar_interpret_noop');
    return;
  }

  let findingRows: unknown[];
  try {
    findingRows = await db().audits.listFindingsForRebuild(auditId);
  } catch (err) {
    log.error({ code: pgErrorCode(err) }, 'radar_interpret_findings_lookup_failed');
    throw new Error('radar_interpret_findings_lookup_failed');
  }

  const rebuilt = rebuildRunInput({
    facts: audit.facts,
    axisScores: audit.axis_scores,
    llmInput: audit.llm_input,
    findingRows,
  });
  if (!rebuilt.ok) {
    // Not retryable: the persisted data will not change between attempts.
    log.warn({ reason: rebuilt.error }, 'radar_interpret_rebuild_failed');
    await markFailed(auditId, `rebuild:${rebuilt.error}`);
    return;
  }
  const input = rebuilt.input;

  const ai = await getEffectiveAiConfig();
  if (!hasLlmKey(ai)) {
    // No key: the report keeps the deterministic narrative computed at scan time.
    log.warn('radar_interpret_no_llm_key');
    await markFailed(auditId, 'no_llm_key');
    return;
  }
  const narrativeOn = await db()
    .audits.getModules(auditId)
    .then((m) => parseStoredModules(m).narrative)
    .catch(() => true);
  if (!narrativeOn) {
    log.info('radar_interpret_narrative_module_off');
    await markFailed(auditId, 'narrative_disabled');
    return;
  }
  const llmConfig = pickLlmConfig(ai);
  const outcome = await runAuditLlm(input, llmConfig);

  if (!outcome.ok || !outcome.output) {
    const isLastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    log.warn(
      { err: outcome.error, attempts: outcome.attempts, isLastAttempt },
      'radar_interpret_llm_failed',
    );
    if (isLastAttempt) {
      await markFailed(auditId, outcome.error ?? 'llm_failed');
      return;
    }
    throw new Error('radar_interpret_llm_failed');
  }

  applyFindingNarratives(input.findings, outcome.output);
  // Same global score as the scan wrote (Préparation IA folded in when the
  // install included it), so the narrative quotes the number on the report.
  const aiReadiness = parseStoredAiReadiness(
    await db()
      .audits.getAiReadiness(auditId)
      .catch(() => null),
  );
  const { globalScore } = computeGlobalScore(
    input.scores,
    aiGlobalScoreEntry(
      aiReadiness ?? undefined,
      aiReadiness?.included_in_global_score ?? false,
    ),
  );
  const narrative = buildNarrativeFields({
    facts: input.facts,
    findings: input.findings,
    scores: input.scores,
    sectorHints: input.sectorHints,
    globalScore,
    llmOutput: outcome.output,
  });

  const rows = input.findings.map((f) => findingToRow(f, auditId));
  try {
    await db().audits.upsertFindings(rows);
  } catch (err) {
    log.error({ code: pgErrorCode(err) }, 'radar_interpret_findings_upsert_failed');
    throw new Error('radar_interpret_findings_upsert_failed');
  }

  try {
    await db().audits.updateIfLlmStatus(auditId, 'pending', {
      ...narrativeColumns(narrative),
      llm_provider: llmConfig.provider,
      llm_model: llmConfig.model,
      llm_tokens_in: outcome.tokensIn ?? 0,
      llm_tokens_out: outcome.tokensOut ?? 0,
      llm_duration_ms: outcome.durationMs,
      llm_error: null,
      llm_status: 'done',
      interpreted_at: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ code: pgErrorCode(err) }, 'radar_interpret_update_failed');
    throw new Error('radar_interpret_update_failed');
  }

  log.info(
    {
      findings: input.findings.length,
      tokensIn: outcome.tokensIn,
      tokensOut: outcome.tokensOut,
      durationMs: outcome.durationMs,
    },
    'radar_interpret_done',
  );
}

/** Best-effort, like the original write: a DB error here is only logged. */
async function markFailed(auditId: string, reason: string): Promise<void> {
  try {
    await db().audits.updateIfLlmStatus(auditId, 'pending', {
      llm_status: 'failed',
      llm_error: reason.slice(0, 500),
    });
  } catch (err) {
    logger.error({ code: pgErrorCode(err), auditId }, 'radar_interpret_mark_failed_failed');
  }
}
