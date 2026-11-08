import { Worker } from 'bullmq';

import { logger } from '../logger.js';
import { redis } from '../redis.js';

import { processFullAudit } from './full-audit-processor.js';
import { FULL_AUDIT_QUEUE_NAME, type FullAuditJobData } from './full-audit-queue.js';
import { processPurge } from './purge-processor.js';
import { PURGE_QUEUE_NAME, schedulePurge, type PurgeJobData } from './purge-queue.js';
import { processRadarInterpret } from './radar-interpret-processor.js';
import { RADAR_INTERPRET_QUEUE_NAME, type RadarInterpretJobData } from './radar-interpret-queue.js';
import { processWebhookDelivery, processWebhookDispatch } from './webhook-processor.js';
import {
  WEBHOOK_DELIVERY_QUEUE_NAME,
  WEBHOOK_DISPATCH_QUEUE_NAME,
  scheduleWebhookDispatch,
  type WebhookDeliveryJobData,
  type WebhookDispatchJobData,
} from './webhook-queue.js';

let fullAuditWorker: Worker<FullAuditJobData> | null = null;
let radarInterpretWorker: Worker<RadarInterpretJobData> | null = null;
let purgeWorker: Worker<PurgeJobData> | null = null;
let webhookDeliveryWorker: Worker<WebhookDeliveryJobData> | null = null;
let webhookDispatchWorker: Worker<WebhookDispatchJobData> | null = null;

export function startWorker(): void {
  if (fullAuditWorker !== null) return;

  // Full multi-axis audit worker. Concurrency 2 because
  // full audit is mostly network-bound (HTTP probes), not CPU-heavy like
  // axe-on-Playwright. Tune down to 1 if the worker's RAM gets tight
  // (each Chromium-based collector takes 400-600 MB).
  fullAuditWorker = new Worker<FullAuditJobData>(FULL_AUDIT_QUEUE_NAME, processFullAudit, {
    connection: redis,
    concurrency: 2,
  });

  fullAuditWorker.on('completed', (job) => {
    logger.info({ jobId: job.id, auditId: job.data.auditId }, 'full_audit_completed');
  });

  fullAuditWorker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, auditId: job?.data.auditId, err: err.message, attempts: job?.attemptsMade },
      'full_audit_failed',
    );
  });

  fullAuditWorker.on('error', (err) => {
    logger.error({ err: err.message }, 'full_audit_worker_error');
  });

  // Radar deferred narrative: one LLM call per job, network-bound.
  radarInterpretWorker = new Worker<RadarInterpretJobData>(
    RADAR_INTERPRET_QUEUE_NAME,
    processRadarInterpret,
    { connection: redis, concurrency: 2 },
  );
  radarInterpretWorker.on('failed', (job, err) => {
    logger.error(
      { jobId: job?.id, auditId: job?.data.auditId, err: err.message, attempts: job?.attemptsMade },
      'radar_interpret_job_failed',
    );
  });
  radarInterpretWorker.on('error', (err) => {
    logger.error({ err: err.message }, 'radar_interpret_worker_error');
  });

  // Outgoing webhooks: tiny signed POSTs, network-bound.
  webhookDeliveryWorker = new Worker<WebhookDeliveryJobData>(
    WEBHOOK_DELIVERY_QUEUE_NAME,
    processWebhookDelivery,
    { connection: redis, concurrency: 8 },
  );
  webhookDeliveryWorker.on('failed', (job, err) => {
    // Never log job data beyond the ids.
    logger.error(
      { deliveryId: job?.data.deliveryId, attempt: job?.data.attempt, err: err.message },
      'webhook_delivery_job_failed',
    );
  });
  webhookDeliveryWorker.on('error', (err) => {
    logger.error({ err: err.message }, 'webhook_delivery_worker_error');
  });
  webhookDispatchWorker = new Worker<WebhookDispatchJobData>(
    WEBHOOK_DISPATCH_QUEUE_NAME,
    processWebhookDispatch,
    { connection: redis, concurrency: 1 },
  );
  webhookDispatchWorker.on('failed', (_job, err) => {
    logger.error({ err: err.message }, 'webhook_dispatch_failed');
  });
  webhookDispatchWorker.on('error', (err) => {
    logger.error({ err: err.message }, 'webhook_dispatch_worker_error');
  });
  void scheduleWebhookDispatch().catch((err: unknown) => {
    logger.error(
      { err: err instanceof Error ? err.message : 'unknown' },
      'webhook_dispatch_schedule_failed',
    );
  });

  // Daily purge of expired audits (replaces the former pg_cron job).
  purgeWorker = new Worker<PurgeJobData>(PURGE_QUEUE_NAME, processPurge, {
    connection: redis,
    concurrency: 1,
  });
  purgeWorker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, 'purge_job_failed');
  });
  purgeWorker.on('error', (err) => {
    logger.error({ err: err.message }, 'purge_worker_error');
  });
  void schedulePurge().catch((err: unknown) => {
    logger.error({ err: err instanceof Error ? err.message : 'unknown' }, 'purge_schedule_failed');
  });
}

export async function stopWorker(): Promise<void> {
  if (fullAuditWorker !== null) {
    await fullAuditWorker.close();
    fullAuditWorker = null;
  }
  if (radarInterpretWorker !== null) {
    await radarInterpretWorker.close();
    radarInterpretWorker = null;
  }
  if (purgeWorker !== null) {
    await purgeWorker.close();
    purgeWorker = null;
  }
  if (webhookDispatchWorker !== null) {
    await webhookDispatchWorker.close();
    webhookDispatchWorker = null;
  }
  if (webhookDeliveryWorker !== null) {
    await webhookDeliveryWorker.close();
    webhookDeliveryWorker = null;
  }
}
