import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { RADAR_TRACKING_TOKEN_PATTERN } from '@mynto/shared';

/**
 * Tracking token of a Radar link (/r/<token>). 24 random bytes encoded in
 * base64url = 32 URL-safe characters, 192 bits of entropy. It is a bearer
 * secret: whoever holds it sees the report, so it is never logged.
 */
export const TRACKING_TOKEN_BYTES = 24;
export const TRACKING_TOKEN_PATTERN = RADAR_TRACKING_TOKEN_PATTERN;

export function generateTrackingToken(): string {
  return randomBytes(TRACKING_TOKEN_BYTES).toString('base64url');
}

export function trackingUrl(webBaseUrl: string, token: string): string {
  return `${webBaseUrl.replace(/\/+$/, '')}/r/${token}`;
}

function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

/**
 * Constant-time string comparison. Hashing first keeps both buffers at 32
 * bytes, so `timingSafeEqual` never throws on a length mismatch and the
 * comparison leaks neither length nor content (same as lib/admin-auth.ts).
 */
export function constantTimeEqual(provided: string, expected: string): boolean {
  return timingSafeEqual(sha256(provided), sha256(expected));
}

/**
 * Extracts the token from an `Authorization: Bearer <token>` header and
 * compares it in constant time. Returns false on any malformed header.
 */
export function verifyBearer(header: string | string[] | undefined, expected: string): boolean {
  const raw = Array.isArray(header) ? header[0] : header;
  if (typeof raw !== 'string') return false;
  const match = /^Bearer\s+(\S{1,512})$/.exec(raw.trim());
  const token = match?.[1];
  if (token === undefined) return false;
  return constantTimeEqual(token, expected);
}
