import { Queue, type JobsOptions } from 'bullmq';

import { redis } from '../redis.js';

export const FULL_AUDIT_QUEUE_NAME = 'full-audit-queue';

export interface FullAuditJobData {
  auditId: string;
  slug: string;
  url: string;
  /** Radar prospection audit: the narrative LLM call is deferred. */
  radar?: boolean;
}

const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 10_000 },
  removeOnComplete: { age: 24 * 3600, count: 200 },
  removeOnFail: { age: 7 * 24 * 3600, count: 500 },
};

export const fullAuditQueue = new Queue<FullAuditJobData>(FULL_AUDIT_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: DEFAULT_JOB_OPTIONS,
});

export async function enqueueFullAudit(data: FullAuditJobData): Promise<void> {
  await fullAuditQueue.add('full-audit', data);
}

export async function getFullAuditQueueCounts(): Promise<{
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
}> {
  const counts = await fullAuditQueue.getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
  );
  return {
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
    delayed: counts.delayed ?? 0,
  };
}
