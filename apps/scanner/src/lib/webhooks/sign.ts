import { createHmac, timingSafeEqual } from 'node:crypto';

import { buildWebhookHeaders as buildLegacyRadarHeaders } from '../radar/webhook.js';

/**
 * Signature of the outgoing webhooks (docs/webhooks.md).
 *
 *   X-Mynto-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">
 *   X-Mynto-Event:     event type (audit.completed, link.opened, ping...)
 *   X-Mynto-Delivery:  delivery id (a "Renvoyer" gets a new one; the body id stays)
 *
 * The timestamp and the signature are recomputed on every attempt (receivers
 * refuse signatures older than 5 minutes); the body never changes.
 *
 * Endpoints flagged legacy_radar_format keep the historical Radar headers
 * (X-Mynto-Timestamp + X-Mynto-Signature "sha256=..."), byte for byte.
 */

export const WEBHOOK_USER_AGENT = 'Mynto-Webhook/1.0';

export function webhookSignature(secret: string, timestamp: string, rawBody: string): string {
  const hex = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${hex}`;
}

export function buildStandardHeaders(input: {
  secret: string;
  rawBody: string;
  eventType: string;
  deliveryId: string;
  now?: Date;
}): Record<string, string> {
  const ts = Math.floor((input.now ?? new Date()).getTime() / 1000).toString();
  return {
    'Content-Type': 'application/json',
    'User-Agent': WEBHOOK_USER_AGENT,
    'X-Mynto-Event': input.eventType,
    'X-Mynto-Delivery': input.deliveryId,
    'X-Mynto-Signature': webhookSignature(input.secret, ts, input.rawBody),
  };
}

export { buildLegacyRadarHeaders };

/**
 * Receiver-side check (used by the tests and documented for integrators):
 * parses the header, refuses timestamps outside the tolerance and compares
 * in constant time.
 */
export function verifyWebhookSignature(input: {
  secret: string;
  header: string | null | undefined;
  rawBody: string;
  toleranceS?: number;
  now?: Date;
}): boolean {
  if (!input.header) return false;
  const parts = Object.fromEntries(
    input.header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  ) as Record<string, string | undefined>;
  const t = parts.t;
  const v1 = parts.v1;
  if (t === undefined || v1 === undefined || !/^\d+$/.test(t) || !/^[0-9a-f]{64}$/.test(v1)) {
    return false;
  }
  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(now - Number(t)) > (input.toleranceS ?? 300)) return false;
  const expected = createHmac('sha256', input.secret).update(`${t}.${input.rawBody}`).digest();
  return timingSafeEqual(expected, Buffer.from(v1, 'hex'));
}
