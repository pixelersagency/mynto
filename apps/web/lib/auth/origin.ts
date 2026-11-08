import 'server-only';

import { headers } from 'next/headers';

import { publicUrl } from '../env';

import { requireAdmin } from './admin';
import type { AdminSession } from './session';

/**
 * CSRF guard for dashboard mutations (server actions). Next.js already
 * refuses server actions whose Origin does not match the Host; this check
 * is explicit and also accepts the configured PUBLIC_URL behind a proxy.
 * A mutation without an Origin header is refused (browsers always send it
 * on POST).
 */
export function isSameOrigin(
  origin: string | null,
  host: string | null,
  publicBase: string,
): boolean {
  if (origin === null || origin === 'null') return false;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  if (host !== null && o.host === host) return true;
  try {
    return o.origin === new URL(publicBase).origin;
  } catch {
    return false;
  }
}

export class CrossOriginError extends Error {
  constructor() {
    super('cross-origin mutation refused');
    this.name = 'CrossOriginError';
  }
}

/** requireAdmin() + same-origin check. Use it first in every mutation. */
export async function requireAdminMutation(): Promise<AdminSession> {
  const session = await requireAdmin();
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (!isSameOrigin(h.get('origin'), host, publicUrl())) throw new CrossOriginError();
  return session;
}
