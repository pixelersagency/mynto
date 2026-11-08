import 'server-only';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { getServerEnv, isHttpsInstall } from '../env';

import { constantTimeEqualStrings, verifyPasswordHash } from './password';
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  verifySession,
  type AdminSession,
} from './session';

export type AdminConfigStatus =
  | { ok: true; email: string; mode: 'hash' | 'plain'; secret: string }
  | { ok: false; missing: string[] };

/** What the login needs, or the list of missing env vars (shown on /login). */
export function adminConfigStatus(): AdminConfigStatus {
  const env = getServerEnv();
  const missing: string[] = [];
  if (!env.ADMIN_EMAIL) missing.push('ADMIN_EMAIL');
  if (!env.ADMIN_PASSWORD_HASH && !env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD_HASH');
  if (!env.SESSION_SECRET) missing.push('SESSION_SECRET');
  if (missing.length > 0 || !env.ADMIN_EMAIL || !env.SESSION_SECRET) return { ok: false, missing };
  return {
    ok: true,
    email: env.ADMIN_EMAIL,
    mode: env.ADMIN_PASSWORD_HASH ? 'hash' : 'plain',
    secret: env.SESSION_SECRET,
  };
}

/**
 * Checks email + password. Both comparisons always run (no early return on
 * a wrong email) and are constant time; the hash is preferred over the
 * plain password when both are set.
 */
export async function verifyAdminCredentials(email: string, password: string): Promise<boolean> {
  const env = getServerEnv();
  const status = adminConfigStatus();
  if (!status.ok) return false;
  const emailOk = constantTimeEqualStrings(
    email.trim().toLowerCase(),
    status.email.trim().toLowerCase(),
  );
  let passwordOk: boolean;
  if (env.ADMIN_PASSWORD_HASH) {
    passwordOk = await verifyPasswordHash(password, env.ADMIN_PASSWORD_HASH);
  } else {
    passwordOk = constantTimeEqualStrings(password, env.ADMIN_PASSWORD ?? '');
  }
  return emailOk && passwordOk;
}

export async function startSession(): Promise<void> {
  const status = adminConfigStatus();
  if (!status.ok) throw new Error('admin not configured');
  const token = await signSession(status.email, status.secret);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(isHttpsInstall()));
}

export async function endSession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, '', {
    ...sessionCookieOptions(isHttpsInstall()),
    maxAge: 0,
  });
}

/** Current admin session, or null. */
export async function getAdminSession(): Promise<AdminSession | null> {
  const env = getServerEnv();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(token, env.SESSION_SECRET, { expectedEmail: env.ADMIN_EMAIL });
}

/**
 * Gate for pages and server actions. The middleware already redirects
 * anonymous requests; this is the second, mandatory check (a server action
 * can be invoked on any route).
 */
export async function requireAdmin(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (session === null) redirect('/login');
  return session;
}
