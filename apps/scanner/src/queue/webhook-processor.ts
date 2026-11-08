import { db, decryptSecret, webhookSecretAad } from '@mynto/db';
import type { Job } from 'bullmq';

import { config, publicBaseUrl } from '../config.js';
import { deliverOnce, dispatchTick } from '../lib/webhooks/deliver.js';
import { logger } from '../logger.js';

import { enqueueWebhookDelivery, type WebhookDeliveryJobData } from './webhook-queue.js';

/** One attempt of one delivery. Bodies, URLs and secrets are never logged. */
export async function processWebhookDelivery(job: Job<WebhookDeliveryJobData>): Promise<void> {
  const { deliveryId, attempt } = job.data;
  const log = logger.child({ queue: 'webhook-delivery', deliveryId, attempt });
  const res = await deliverOnce(deliveryId, attempt, {
    repo: db().webhooks,
    decryptSecret: (endpointId, ciphertext) =>
      decryptSecret(ciphertext, config.APP_ENCRYPTION_KEY, webhookSecretAad(endpointId)),
    radarSecret: config.RADAR_WEBHOOK_SECRET ?? null,
    allowPrivate: config.WEBHOOKS_ALLOW_PRIVATE,
  });
  switch (res.kind) {
    case 'skipped':
      return;
    case 'cancelled':
      log.info({ reason: res.reason }, 'webhook_delivery_cancelled');
      return;
    case 'success':
      log.info({ status: res.statusCode }, 'webhook_delivered');
      return;
    case 'retry':
      log.warn(
        { status: res.statusCode, error: res.error, next: res.nextAttempt },
        'webhook_retry',
      );
      // The sweep would pick it up anyway; the delayed job is just on time.
      await enqueueWebhookDelivery(deliveryId, res.nextAttempt, res.delayMs).catch(
        (err: unknown) => {
          log.warn(
            { err: err instanceof Error ? err.message : 'unknown' },
            'webhook_retry_enqueue_failed',
          );
        },
      );
      return;
    case 'failed':
      log.error({ status: res.statusCode, error: res.error }, 'webhook_delivery_failed');
      if (res.endpointDisabled) log.error('webhook_endpoint_auto_disabled');
      return;
  }
}

/** Repeatable tick: outbox fan-out and sweep of due deliveries. */
export async function processWebhookDispatch(): Promise<void> {
  const res = await dispatchTick({
    repo: db().webhooks,
    baseUrl: publicBaseUrl(),
    enqueue: (id, attempt) => enqueueWebhookDelivery(id, attempt),
  });
  if (res.fannedOut > 0 || res.due > 0) logger.debug(res, 'webhook_dispatch_tick');
}

/**
 * Keeps the Radar endpoint in sync with RADAR_WEBHOOK_URL / RADAR_WEBHOOK_SECRET
 * (both required, like before). Called once at boot.
 */
export async function syncRadarWebhookEndpoint(): Promise<void> {
  const url =
    config.RADAR_WEBHOOK_URL !== undefined && config.RADAR_WEBHOOK_SECRET !== undefined
      ? config.RADAR_WEBHOOK_URL
      : null;
  const row = await db().webhooks.syncRadarEndpoint(url);
  if (row !== null) {
    logger.info(
      { active: row.active, legacy: row.legacy_radar_format },
      'radar_webhook_endpoint_synced',
    );
  }
}
