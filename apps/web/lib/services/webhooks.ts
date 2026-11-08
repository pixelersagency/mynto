import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  EncryptionKeyInvalidError,
  EncryptionKeyMissingError,
  encryptSecret,
  generateWebhookSecret,
  maskSecret,
  webhookSecretAad,
  type WebhookDeliveryDetail,
  type WebhookDeliveryRow,
  type WebhookEndpointRow,
} from '@mynto/db';
import {
  WEBHOOK_URL_PROBLEM_MESSAGE,
  webhookUrlProblem,
  type ApiWebhook,
  type ApiWebhookCreateBody,
  type ApiWebhookDeliveriesQuery,
  type ApiWebhookDelivery,
  type ApiWebhookTestResult,
  type ApiWebhookUpdateBody,
  type ApiWebhookWithSecret,
} from '@mynto/shared';

import { db, pgErrorCode } from '../db';
import { getServerEnv } from '../env';
import { logger } from '../logger';

import { ServiceError } from './audits';

/**
 * Service layer of the outgoing webhooks, shared by the settings page
 * (server actions), the REST API v1 and the MCP tools. The signing secret
 * is generated here, encrypted with APP_ENCRYPTION_KEY and returned once
 * (creation, regeneration); it is never read back nor logged.
 */

function dbFailure(err: unknown, what: string): ServiceError {
  logger.error({ code: pgErrorCode(err) }, what);
  return new ServiceError('database_error', 503, 'Base de données indisponible.');
}

const notFound = (): ServiceError => new ServiceError('not_found', 404, 'Webhook introuvable.');

export function allowPrivateTargets(): boolean {
  return getServerEnv().WEBHOOKS_ALLOW_PRIVATE;
}

/** Endpoint row -> API shape. Pure. */
export function toApiWebhook(row: WebhookEndpointRow): ApiWebhook {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    events: row.events,
    active: row.active,
    legacy_radar_format: row.legacy_radar_format,
    managed_by_env: row.system_key !== null,
    secret_hint: row.secret_hint,
    consecutive_failures: row.consecutive_failures,
    disabled_at: row.disabled_at,
    disabled_reason: row.disabled_reason,
    last_status: row.last_status,
    last_status_code: row.last_status_code,
    last_delivery_at: row.last_delivery_at,
    created_at: row.created_at,
  };
}

export function toApiDelivery(row: WebhookDeliveryRow | WebhookDeliveryDetail): ApiWebhookDelivery {
  const out: ApiWebhookDelivery = {
    id: row.id,
    endpoint_id: row.endpoint_id,
    event_id: row.event_id,
    event_type: row.event_type,
    format: row.format,
    status: row.status,
    attempts: row.attempts,
    next_attempt_at: row.status === 'pending' ? row.next_attempt_at : null,
    last_status_code: row.last_status_code,
    last_duration_ms: row.last_duration_ms,
    last_error: row.last_error,
    manual: row.manual,
    created_at: row.created_at,
    completed_at: row.completed_at,
  };
  if ('request_body' in row) {
    out.request_body = row.request_body;
    out.attempts_log = row.attempts_log;
  }
  return out;
}

function checkUrl(url: string): string {
  const u = url.trim();
  const problem = webhookUrlProblem(u, allowPrivateTargets());
  if (problem !== null) {
    throw new ServiceError('invalid_url', 400, WEBHOOK_URL_PROBLEM_MESSAGE[problem]);
  }
  return u;
}

function newSecret(endpointId: string): { secret: string; ciphertext: string; hint: string } {
  const secret = generateWebhookSecret();
  try {
    return {
      secret,
      ciphertext: encryptSecret(
        secret,
        getServerEnv().APP_ENCRYPTION_KEY,
        webhookSecretAad(endpointId),
      ),
      hint: maskSecret(secret),
    };
  } catch (err) {
    if (err instanceof EncryptionKeyMissingError || err instanceof EncryptionKeyInvalidError) {
      throw new ServiceError(
        'encryption_key_missing',
        503,
        'APP_ENCRYPTION_KEY manque ou est invalide : le secret ne peut pas être chiffré.',
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------

export async function listWebhooks(): Promise<ApiWebhook[]> {
  try {
    return (await db().webhooks.list()).map(toApiWebhook);
  } catch (err) {
    throw dbFailure(err, 'service_list_webhooks_failed');
  }
}

export async function getWebhook(id: string): Promise<ApiWebhook> {
  let row: WebhookEndpointRow | null;
  try {
    row = await db().webhooks.get(id);
  } catch (err) {
    throw dbFailure(err, 'service_get_webhook_failed');
  }
  if (row === null) throw notFound();
  return toApiWebhook(row);
}

export async function createWebhook(input: ApiWebhookCreateBody): Promise<ApiWebhookWithSecret> {
  const url = checkUrl(input.url);
  const id = randomUUID();
  const s = newSecret(id);
  try {
    const row = await db().webhooks.create({
      id,
      url,
      description: input.description ?? null,
      events: input.events,
      active: input.active ?? true,
      secretCiphertext: s.ciphertext,
      secretHint: s.hint,
    });
    logger.info({ webhookId: id, events: input.events.length }, 'webhook_created');
    return { ...toApiWebhook(row), secret: s.secret };
  } catch (err) {
    throw dbFailure(err, 'service_create_webhook_failed');
  }
}

export async function updateWebhook(id: string, patch: ApiWebhookUpdateBody): Promise<ApiWebhook> {
  const current = await getWebhook(id);
  if (patch.url !== undefined && current.managed_by_env) {
    throw new ServiceError(
      'managed_by_env',
      409,
      'L’adresse de ce webhook vient de RADAR_WEBHOOK_URL : change-la dans le .env.',
    );
  }
  const url = patch.url !== undefined ? checkUrl(patch.url) : undefined;
  try {
    const row = await db().webhooks.update(id, {
      ...(url !== undefined ? { url } : {}),
      ...(patch.description !== undefined
        ? { description: patch.description === '' ? null : patch.description }
        : {}),
      ...(patch.events !== undefined ? { events: patch.events } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.legacy_radar_format !== undefined
        ? { legacy_radar_format: patch.legacy_radar_format }
        : {}),
    });
    if (row === null) throw notFound();
    logger.info({ webhookId: id }, 'webhook_updated');
    return toApiWebhook(row);
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw dbFailure(err, 'service_update_webhook_failed');
  }
}

export async function rotateWebhookSecret(id: string): Promise<ApiWebhookWithSecret> {
  const current = await getWebhook(id);
  if (current.managed_by_env) {
    throw new ServiceError(
      'managed_by_env',
      409,
      'Le secret de ce webhook vient de RADAR_WEBHOOK_SECRET : change-le dans le .env.',
    );
  }
  const s = newSecret(id);
  try {
    const row = await db().webhooks.setSecret(id, s.ciphertext, s.hint);
    if (row === null) throw notFound();
    logger.info({ webhookId: id }, 'webhook_secret_rotated');
    return { ...toApiWebhook(row), secret: s.secret };
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw dbFailure(err, 'service_rotate_webhook_failed');
  }
}

export async function deleteWebhook(id: string): Promise<void> {
  const current = await getWebhook(id);
  if (current.managed_by_env) {
    throw new ServiceError(
      'managed_by_env',
      409,
      'Ce webhook vient du .env (RADAR_WEBHOOK_URL). Retire la variable pour le désactiver.',
    );
  }
  try {
    if (!(await db().webhooks.delete(id))) throw notFound();
    logger.info({ webhookId: id }, 'webhook_deleted');
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw dbFailure(err, 'service_delete_webhook_failed');
  }
}

/** Queues a "ping" event for this endpoint (sent within a few seconds by the scanner). */
export async function testWebhook(id: string): Promise<ApiWebhookTestResult> {
  await getWebhook(id);
  try {
    const eventId = await db().webhooks.ping(id);
    if (eventId === null) throw notFound();
    return { event_id: eventId, status: 'queued' };
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw dbFailure(err, 'service_test_webhook_failed');
  }
}

export async function listDeliveries(
  id: string,
  q: ApiWebhookDeliveriesQuery,
): Promise<{
  data: ApiWebhookDelivery[];
  pagination: { limit: number; offset: number; total: number };
}> {
  await getWebhook(id);
  try {
    const res = await db().webhooks.listDeliveries(id, q);
    return {
      data: res.rows.map(toApiDelivery),
      pagination: { limit: q.limit, offset: q.offset, total: res.total },
    };
  } catch (err) {
    throw dbFailure(err, 'service_list_deliveries_failed');
  }
}

export async function getDelivery(
  webhookId: string,
  deliveryId: string,
): Promise<ApiWebhookDelivery> {
  let row: WebhookDeliveryDetail | null;
  try {
    row = await db().webhooks.getDelivery(deliveryId);
  } catch (err) {
    throw dbFailure(err, 'service_get_delivery_failed');
  }
  if (row?.endpoint_id !== webhookId) {
    throw new ServiceError('not_found', 404, 'Livraison introuvable.');
  }
  return toApiDelivery(row);
}

/** "Renvoyer": a new delivery of the same event (same body, same event id). */
export async function resendDelivery(
  webhookId: string,
  deliveryId: string,
): Promise<{ delivery_id: string }> {
  await getDelivery(webhookId, deliveryId);
  try {
    const id = await db().webhooks.resend(deliveryId);
    if (id === null) throw new ServiceError('not_found', 404, 'Livraison introuvable.');
    logger.info({ webhookId }, 'webhook_delivery_resent');
    return { delivery_id: id };
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    throw dbFailure(err, 'service_resend_failed');
  }
}

/** Endpoints switched off after 20 final failures (Home and settings alert). */
export async function autoDisabledWebhooks(): Promise<ApiWebhook[]> {
  try {
    return (await db().webhooks.listAutoDisabled()).map(toApiWebhook);
  } catch (err) {
    logger.warn({ code: pgErrorCode(err) }, 'webhook_alerts_read_failed');
    return [];
  }
}
