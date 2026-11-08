import { Queue } from 'bullmq';

import { redis } from '../redis.js';

/**
 * Outgoing webhooks (docs/webhooks.md).
 *
 *   webhook-dispatch  repeatable tick (every 3 s): outbox fan-out + sweep of
 *                     due deliveries (crash recovery);
 *   webhook-delivery  one job per attempt, jobId "<delivery>-<attempt>".
 *
 * The retry schedule lives in Postgres (next_attempt_at): a retry is a
 * delayed job, and the sweep re-enqueues anything whose job was lost.
 * Jobs are removed once done so their ids can be reused by the sweep.
 */

export const WEBHOOK_DELIVERY_QUEUE_NAME = 'webhook-delivery';
export const WEBHOOK_DISPATCH_QUEUE_NAME = 'webhook-dispatch';
const DISPATCH_SCHEDULER_ID = 'webhook-dispatch-tick';
export const WEBHOOK_DISPATCH_EVERY_MS = 3_000;

export interface WebhookDeliveryJobData {
  deliveryId: string;
  attempt: number;
}
export type WebhookDispatchJobData = Record<string, never>;

export const webhookDeliveryQueue = new Queue<WebhookDeliveryJobData>(WEBHOOK_DELIVERY_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: true },
});

export const webhookDispatchQueue = new Queue<WebhookDispatchJobData>(WEBHOOK_DISPATCH_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: { attempts: 1, removeOnComplete: true, removeOnFail: { count: 50 } },
});

export async function enqueueWebhookDelivery(
  deliveryId: string,
  attempt: number,
  delayMs = 0,
): Promise<void> {
  await webhookDeliveryQueue.add(
    'deliver',
    { deliveryId, attempt },
    { jobId: `${deliveryId}-${String(attempt)}`, ...(delayMs > 0 ? { delay: delayMs } : {}) },
  );
}

/** Idempotent: a fixed scheduler id, so replicas never duplicate the tick. */
export async function scheduleWebhookDispatch(): Promise<void> {
  await webhookDispatchQueue.upsertJobScheduler(
    DISPATCH_SCHEDULER_ID,
    { every: WEBHOOK_DISPATCH_EVERY_MS },
    { name: 'tick', data: {} },
  );
}
