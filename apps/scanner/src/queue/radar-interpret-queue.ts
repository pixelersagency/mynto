import { Queue, type JobsOptions } from 'bullmq';

import { redis } from '../redis.js';

export const RADAR_INTERPRET_QUEUE_NAME = 'radar-interpret';

export interface RadarInterpretJobData {
  /** audits_full.id (the scan), not radar_audits.id: one interpretation per scan. */
  auditId: string;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 30_000 },
  // Removed as soon as they finish so the deterministic jobId below only
  // dedupes jobs that are still waiting/active. A later re-request (after
  // a failure) can then enqueue again under the same id.
  removeOnComplete: true,
  removeOnFail: true,
};

export const radarInterpretQueue = new Queue<RadarInterpretJobData>(RADAR_INTERPRET_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

/**
 * Idempotent: BullMQ ignores `add` when a job with the same id is already
 * queued or running, so concurrent triggers (Radar validation + first view
 * + scan completion) collapse into one LLM call.
 */
export async function enqueueRadarInterpret(auditId: string): Promise<void> {
  await radarInterpretQueue.add('radar-interpret', { auditId }, { jobId: `interpret-${auditId}` });
}
