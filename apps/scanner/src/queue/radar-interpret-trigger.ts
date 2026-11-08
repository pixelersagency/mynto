import { db, pgErrorCode, type AuditStateRow } from '@mynto/db';

import { logger as rootLogger } from '../logger.js';

import { enqueueRadarInterpret } from './radar-interpret-queue.js';

/**
 * Deferred narrative (Radar audits) state machine on audits_full.llm_status:
 *
 *   deferred --request--> pending --scan completed + job--> done
 *                            |                          \-> failed --request--> pending
 *
 * Two independent writers can race: a trigger (Radar's interpret call or
 * the first real view) and the scan finishing. Each side writes first and
 * reads the other side's state after its own write, so whichever lands
 * last sees both conditions and enqueues. The BullMQ jobId dedupes the
 * case where both enqueue.
 */

interface Log {
  info: (o: object, m?: string) => void;
  warn: (o: object, m?: string) => void;
  error: (o: object, m?: string) => void;
}

export type InterpretRequestResult =
  | 'queued'
  | 'waiting_scan'
  | 'already_done'
  | 'scan_failed'
  | 'not_applicable'
  | 'not_found'
  | 'error';

export async function requestInterpretation(
  auditId: string,
  log: Log = rootLogger,
): Promise<InterpretRequestResult> {
  let row: AuditStateRow | null;
  try {
    row = await db().audits.getState(auditId);
  } catch (err) {
    log.error({ code: pgErrorCode(err), auditId }, 'radar_interpret_lookup_failed');
    return 'error';
  }
  if (row === null) return 'not_found';
  if (row.source !== 'radar' || row.llm_status === null) return 'not_applicable';
  if (row.llm_status === 'done') return 'already_done';
  if (row.status === 'failed') return 'scan_failed';

  let state: AuditStateRow = row;
  if (row.llm_status === 'deferred' || row.llm_status === 'failed') {
    // Conditional update = atomic claim. If another trigger won, the row
    // is already pending and this update matches nothing.
    let claimed: AuditStateRow | null;
    try {
      claimed = await db().audits.claimInterpretation(auditId);
    } catch (err) {
      log.error({ code: pgErrorCode(err), auditId }, 'radar_interpret_claim_failed');
      return 'error';
    }
    if (claimed !== null) {
      state = claimed;
    } else {
      const reread = await db()
        .audits.getState(auditId)
        .catch(() => null);
      if (reread === null) return 'error';
      state = reread;
      if (state.llm_status === 'done') return 'already_done';
    }
  }

  if (state.status !== 'completed') {
    log.info({ auditId }, 'radar_interpret_waiting_scan');
    return 'waiting_scan';
  }
  // pending + completed: make sure a job exists. Same jobId while queued
  // or active = no-op, so a repeat call never doubles the LLM cost.
  await enqueueRadarInterpret(auditId);
  log.info({ auditId }, 'radar_interpret_queued');
  return 'queued';
}

/** Called by the full-audit processor once a Radar scan is persisted. */
export async function onRadarScanCompleted(auditId: string, log: Log): Promise<void> {
  let current: AuditStateRow | null;
  try {
    current = await db().audits.getState(auditId);
  } catch (err) {
    log.warn({ code: pgErrorCode(err) }, 'radar_scan_completed_lookup_failed');
    return;
  }
  if (current?.llm_status === 'pending') {
    try {
      await enqueueRadarInterpret(auditId);
      log.info({ auditId }, 'radar_interpret_queued_after_scan');
    } catch (err) {
      log.error(
        { err: err instanceof Error ? err.message : 'unknown' },
        'radar_interpret_enqueue_failed',
      );
    }
  }
}
