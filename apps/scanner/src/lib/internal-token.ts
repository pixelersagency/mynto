import { constantTimeEqual } from './radar/tokens.js';

/** Header carrying SCANNER_INTERNAL_TOKEN on web -> scanner calls. */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/** Constant-time check of the internal token (pure, for tests). */
export function verifyInternalToken(
  provided: string | string[] | undefined,
  expected: string | undefined,
): boolean {
  if (expected === undefined || expected.length === 0) return false;
  const token = Array.isArray(provided) ? provided[0] : provided;
  if (typeof token !== 'string' || token.length === 0 || token.length > 512) return false;
  return constantTimeEqual(token, expected);
}
