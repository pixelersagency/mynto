import { z } from 'zod';

export const SLUG_PATTERN = /^[A-Za-z0-9_-]{10,20}$/;
export const SlugSchema = z.string().regex(SLUG_PATTERN, 'invalid_slug');

/**
 * Le slug traverse deux services : le scanner le génère, le web le reçoit
 * par HTTP puis le colle dans une route. Ce garde permet au web de le
 * vérifier sans monter un parse Zod complet.
 */
export function isValidSlug(value: unknown): value is string {
  return typeof value === 'string' && SLUG_PATTERN.test(value);
}
