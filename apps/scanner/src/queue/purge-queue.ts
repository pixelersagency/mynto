import { Queue } from 'bullmq';

import { redis } from '../redis.js';

export const PURGE_QUEUE_NAME = 'maintenance-purge';
const PURGE_SCHEDULER_ID = 'purge-expired-audits';

/** Daily at 03:17 (server time), like the former pg_cron job. */
export const PURGE_CRON = '17 3 * * *';

export type PurgeJobData = Record<string, never>;

export const purgeQueue = new Queue<PurgeJobData>(PURGE_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60_000 },
    removeOnComplete: { count: 30 },
    removeOnFail: { count: 30 },
  },
});

/**
 * Registers (or updates) the repeatable purge job. Idempotent: the
 * scheduler id is fixed, so every scanner boot upserts the same schedule
 * and several replicas never create duplicates.
 */
export async function schedulePurge(): Promise<void> {
  await purgeQueue.upsertJobScheduler(
    PURGE_SCHEDULER_ID,
    { pattern: PURGE_CRON },
    { name: 'purge-expired-audits', data: {} },
  );
}
