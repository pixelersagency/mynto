import { createHmac } from 'node:crypto';

/**
 * Outbound webhook to Radar (contract: Radar docs/MYNTO.md section 5).
 *
 *   X-Mynto-Timestamp : unix seconds at send time
 *   X-Mynto-Signature : "sha256=" + hex HMAC-SHA256 of `${ts}.${rawBody}`
 *
 * Radar rejects timestamps older than 5 minutes, so the timestamp and the
 * signature are recomputed on every attempt. The body is fixed at enqueue
 * time (occurred_at included) because Radar dedupes on
 * (tracking_token, occurred_at).
 */

export interface AuditViewedEvent {
  tracking_token: string;
  event: 'audit_viewed';
  occurred_at: string;
  /** Deprecated since the CNIL-friendly beacon: always 0. Kept for the contract. */
  duration_s: number;
  /** Deprecated since the CNIL-friendly beacon: always []. Kept for the contract. */
  sections_viewed: string[];
}

export function signWebhook(secret: string, timestamp: string, rawBody: string): string {
  const hex = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `sha256=${hex}`;
}

export function buildWebhookHeaders(
  secret: string,
  rawBody: string,
  now: Date = new Date(),
): Record<string, string> {
  const ts = Math.floor(now.getTime() / 1000).toString();
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'Mynto-Webhook/1.0',
    'X-Mynto-Timestamp': ts,
    'X-Mynto-Signature': signWebhook(secret, ts, rawBody),
  };
}

/** Retry on 5xx (and 429, a transient overload) only. 4xx is final. */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429;
}
