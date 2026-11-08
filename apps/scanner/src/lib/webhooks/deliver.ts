import type { AttemptOutcome, WebhooksRepo } from '@mynto/db';
import { isRetryableWebhookFailure } from '@mynto/shared';

import { sendWebhookRequest } from './send.js';
import { buildLegacyRadarHeaders, buildStandardHeaders } from './sign.js';
import type { LookupAll } from './target.js';

/**
 * Dispatcher core, free of BullMQ and of the scanner config so it can be
 * driven directly by the integration tests:
 *
 *   dispatchTick  outbox -> deliveries (fan-out), then every due delivery
 *                 is handed to `enqueue` (BullMQ in production);
 *   deliverOnce   one attempt: claim, sign, send, record, decide the retry.
 *
 * Secrets are decrypted per attempt and never logged; nor are bodies.
 */

export interface DispatchDeps {
  repo: Pick<WebhooksRepo, 'fanOut' | 'listDue'>;
  baseUrl: string;
  enqueue: (deliveryId: string, attempt: number) => Promise<void>;
}

export async function dispatchTick(
  deps: DispatchDeps,
): Promise<{ fannedOut: number; due: number }> {
  const created = await deps.repo.fanOut(deps.baseUrl);
  for (const id of created) await deps.enqueue(id, 1);
  // Safety sweep: deliveries whose job was lost (crash, Redis flush) or
  // whose retry is due. A duplicate job is harmless: claim() lets one through.
  const due = (await deps.repo.listDue()).filter((d) => !created.includes(d.id));
  for (const d of due) await deps.enqueue(d.id, d.attempt);
  return { fannedOut: created.length, due: due.length };
}

export interface DeliverDeps {
  repo: Pick<WebhooksRepo, 'claim' | 'recordAttempt' | 'cancel'>;
  /** Decrypts an endpoint secret (throws when APP_ENCRYPTION_KEY is wrong or missing). */
  decryptSecret: (endpointId: string, ciphertext: string) => string;
  /** RADAR_WEBHOOK_SECRET, signs the env-managed Radar endpoint. */
  radarSecret: string | null;
  allowPrivate: boolean;
  timeoutMs?: number;
  lookup?: LookupAll;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

export type DeliverResult =
  | { kind: 'skipped' }
  | { kind: 'cancelled'; reason: string }
  | (AttemptOutcome & { statusCode: number | null; error: string | null });

export async function deliverOnce(
  deliveryId: string,
  attempt: number,
  deps: DeliverDeps,
): Promise<DeliverResult> {
  const d = await deps.repo.claim(deliveryId, attempt);
  if (d === null) return { kind: 'skipped' };
  if (!d.endpoint_active) {
    await deps.repo.cancel(d.id, attempt, 'endpoint_disabled');
    return { kind: 'cancelled', reason: 'endpoint_disabled' };
  }

  let secret: string | null = null;
  if (d.system_key === 'radar') {
    secret = deps.radarSecret;
  } else if (d.secret_ciphertext !== null) {
    try {
      secret = deps.decryptSecret(d.endpoint_id, d.secret_ciphertext);
    } catch {
      secret = null;
    }
  }
  const ref = { id: d.id, attempt, endpointId: d.endpoint_id };
  if (secret === null || secret.length === 0) {
    const outcome = await deps.repo.recordAttempt(ref, {
      ok: false,
      statusCode: null,
      error: 'secret_unavailable',
      durationMs: 0,
      responseBody: null,
      retryable: false,
    });
    return { ...outcome, statusCode: null, error: 'secret_unavailable' };
  }

  const legacy = d.format === 'legacy_radar';
  const now = deps.now?.() ?? new Date();
  const headers = legacy
    ? buildLegacyRadarHeaders(secret, d.request_body, now)
    : buildStandardHeaders({
        secret,
        rawBody: d.request_body,
        eventType: d.event_type,
        deliveryId: d.id,
        now,
      });

  const res = await sendWebhookRequest({
    url: d.endpoint_url,
    headers,
    body: d.request_body,
    // The env-managed endpoint (RADAR_WEBHOOK_URL) is set by the operator,
    // not through the dashboard or the API: trusted like before phase 4d,
    // when it was sent without any address check.
    allowPrivate: deps.allowPrivate || d.system_key !== null,
    ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
    ...(deps.lookup ? { lookup: deps.lookup } : {}),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  const outcome = await deps.repo.recordAttempt(ref, {
    ...res,
    retryable:
      !res.ok &&
      isRetryableWebhookFailure({ statusCode: res.statusCode, error: res.error, legacy }),
  });
  return { ...outcome, statusCode: res.statusCode, error: res.error };
}
