import { createHash, timingSafeEqual } from 'node:crypto';

import { config } from '../config.js';

function sha256(s: string): Buffer {
  return createHash('sha256').update(s).digest();
}

/**
 * Constant-time check of the admin token.
 *
 * Hashing first keeps both buffers at 32 bytes, so `timingSafeEqual`
 * cannot throw on a length mismatch and the comparison leaks neither the
 * length nor the content of the expected token.
 */
export function verifyAdminToken(provided: string | string[] | undefined): boolean {
  const token = Array.isArray(provided) ? provided[0] : provided;
  if (typeof token !== 'string' || token.length === 0) return false;
  return timingSafeEqual(sha256(token), sha256(config.ADMIN_TOKEN));
}
