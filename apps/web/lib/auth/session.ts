import { SignJWT, jwtVerify } from 'jose';

/**
 * Admin session: a short HS256 JWT (jose) in an httpOnly cookie. No
 * server-side session store: one admin per install, and rotating
 * SESSION_SECRET logs every session out.
 *
 * Kept free of Node-only imports so the middleware can use it whatever its
 * runtime.
 */

export const SESSION_COOKIE = 'mynto_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 3600;
const ISSUER = 'mynto';
const AUDIENCE = 'mynto-admin';

export interface AdminSession {
  email: string;
  /** Expiry, unix seconds. */
  exp: number;
}

function key(secret: string): Uint8Array {
  if (secret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return new TextEncoder().encode(secret);
}

export async function signSession(
  email: string,
  secret: string,
  now: Date = new Date(),
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject('admin')
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_TTL_SECONDS)
    .sign(key(secret));
}

/** Valid session, or null (bad signature, expired, wrong audience, wrong admin). */
export async function verifySession(
  token: string | undefined | null,
  secret: string | undefined,
  opts: { expectedEmail?: string; now?: Date } = {},
): Promise<AdminSession | null> {
  if (!token || !secret || secret.length < 32 || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: 'admin',
      ...(opts.now ? { currentDate: opts.now } : {}),
    });
    const email = payload.email;
    if (typeof email !== 'string' || typeof payload.exp !== 'number') return null;
    // Changing ADMIN_EMAIL invalidates the sessions of the previous admin.
    if (
      opts.expectedEmail !== undefined &&
      email.toLowerCase() !== opts.expectedEmail.toLowerCase()
    ) {
      return null;
    }
    return { email, exp: payload.exp };
  } catch {
    return null;
  }
}

/** Cookie attributes of the session (Secure only when the install is HTTPS). */
export function sessionCookieOptions(secure: boolean): {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
} {
  return { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS };
}
