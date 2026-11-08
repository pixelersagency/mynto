// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  constantTimeEqualStrings,
  hashPassword,
  parseScryptHash,
  verifyPasswordHash,
} from '@/lib/auth/password';
import { isApiPath, isPublicPath } from '@/lib/auth/paths';
import {
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
  signSession,
  verifySession,
} from '@/lib/auth/session';
import { LoginThrottle } from '@/lib/auth/throttle';

const SECRET = 'a'.repeat(40);

describe('password hashing (scrypt)', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^scrypt:32768:8:1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(await verifyPasswordHash('correct horse battery', hash)).toBe(true);
    expect(await verifyPasswordHash('correct horse batterz', hash)).toBe(false);
    expect(await verifyPasswordHash('', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('accepts the CLI output format (scripts/hash-password.mjs)', async () => {
    // Generated with: echo 'correct horse battery' | node scripts/hash-password.mjs
    const fromCli =
      'scrypt:32768:8:1:YvU4xV84X-53ptNhzMMwpA:lgnexE9ANkWhd8ePzL8AL_OINOGwbhHwntgKgMjsG-Y';
    expect(await verifyPasswordHash('correct horse battery', fromCli)).toBe(true);
  });

  it('rejects malformed or weak-parameter hashes', async () => {
    expect(parseScryptHash('scrypt:1024:8:1:AAAAAAAAAAAAAAAAAAAAAA:' + 'A'.repeat(43))).toBeNull();
    expect(parseScryptHash('bcrypt:$2b$10$abc')).toBeNull();
    expect(parseScryptHash('scrypt:32768:8:1:short:key')).toBeNull();
    expect(await verifyPasswordHash('x', 'garbage')).toBe(false);
  });

  it('compares strings in constant time regardless of length', () => {
    expect(constantTimeEqualStrings('abc', 'abc')).toBe(true);
    expect(constantTimeEqualStrings('abc', 'abcd')).toBe(false);
    expect(constantTimeEqualStrings('', '')).toBe(true);
  });
});

describe('session (jose HS256)', () => {
  it('round-trips and expires after 7 days', async () => {
    const now = new Date('2026-11-06T10:00:00Z');
    const token = await signSession('admin@agence.fr', SECRET, now);
    const ok = await verifySession(token, SECRET, { now, expectedEmail: 'ADMIN@agence.fr' });
    expect(ok?.email).toBe('admin@agence.fr');
    expect(ok?.exp).toBe(Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS);
    const later = new Date(now.getTime() + (SESSION_TTL_SECONDS + 60) * 1000);
    expect(await verifySession(token, SECRET, { now: later })).toBeNull();
  });

  it('rejects another secret, another admin, tampering and junk', async () => {
    const token = await signSession('admin@agence.fr', SECRET);
    expect(await verifySession(token, 'b'.repeat(40))).toBeNull();
    expect(await verifySession(token, SECRET, { expectedEmail: 'autre@agence.fr' })).toBeNull();
    const [h, p, s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ email: 'x@y.z', sub: 'admin' })).toString(
      'base64url',
    );
    expect(await verifySession(`${h ?? ''}.${forged}.${s ?? ''}`, SECRET)).toBeNull();
    expect(await verifySession(`${h ?? ''}.${p ?? ''}.`, SECRET)).toBeNull();
    expect(await verifySession('not-a-jwt', SECRET)).toBeNull();
    expect(await verifySession(undefined, SECRET)).toBeNull();
    expect(await verifySession(token, undefined)).toBeNull();
    expect(await verifySession(token, 'short')).toBeNull();
  });

  it('refuses alg none', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({ email: 'a@b.c', sub: 'admin', iss: 'mynto', aud: 'mynto-admin', exp: 9e9 }),
    ).toString('base64url');
    expect(await verifySession(`${header}.${payload}.`, SECRET)).toBeNull();
  });

  it('cookie is httpOnly, SameSite=Lax, Secure only on https', () => {
    expect(sessionCookieOptions(true)).toMatchObject({
      httpOnly: true,
      sameSite: 'lax',
      secure: true,
      path: '/',
    });
    expect(sessionCookieOptions(false).secure).toBe(false);
  });

  it('refuses to sign with a short secret', async () => {
    await expect(signSession('a@b.c', 'short')).rejects.toThrow();
  });
});

describe('middleware access policy', () => {
  it.each([
    ['/login', 'GET'],
    ['/login', 'POST'],
    ['/audit/full/abcdefghij12', 'GET'],
    ['/audit/full/abcdefghij12/pdf', 'GET'],
    ['/audit/full/abcdefghij12/opengraph-image', 'GET'],
    ['/r/abcdefghijklmnopqrstuvwxyz012345', 'GET'],
    ['/media/hero/3f2b8c1e-9a4d-4c2b-8f1e-0123456789ab.png', 'GET'],
    ['/media/brand/logo', 'GET'],
    ['/api/radar/audits', 'POST'],
    ['/api/radar/view', 'POST'],
    ['/api/health', 'GET'],
    ['/api/audits/full/abcdefghij12', 'GET'],
    ['/api/audits/full/abcdefghij12/findings', 'GET'],
    ['/api/audits/full/abcdefghij12/pdf', 'GET'],
    ['/robots.txt', 'GET'],
    // Own Bearer API key check in the route handlers.
    ['/api/v1/audits', 'GET'],
    ['/api/v1/audits', 'POST'],
    ['/api/v1/audits/3f2b8c1e-9a4d-4c2b-8f1e-0123456789ab', 'DELETE'],
    ['/api/v1/openapi.json', 'GET'],
    ['/mcp', 'POST'],
  ])('%s %s is public', (path, method) => {
    expect(isPublicPath(path, method)).toBe(true);
  });

  it.each([
    ['/', 'GET'],
    ['/dashboard', 'GET'],
    ['/dashboard/reglages', 'POST'],
    ['/dashboard/nouveau', 'POST'],
    ['/api/dashboard/export', 'GET'],
    ['/api/audits/full', 'POST'],
    ['/api/audits/full/abcdefghij12', 'POST'],
    ['/api/audits/full/abcdefghij12', 'DELETE'],
    ['/api/audits/full/abcdefghij12/refresh', 'POST'],
    ['/api/v1', 'GET'],
    ['/mcp/x', 'POST'],
    ['/api/v1/../dashboard', 'GET'],
    ['/dashboard/analytics', 'GET'],
    ['/dashboard/reglages/api', 'GET'],
    ['/loginx', 'GET'],
    ['/login/../dashboard', 'GET'],
    ['/r/../dashboard', 'GET'],
    ['//evil.example', 'GET'],
    ['/media/other', 'GET'],
    ['/api/healthz', 'GET'],
  ])('%s %s requires the session', (path, method) => {
    expect(isPublicPath(path, method)).toBe(false);
  });

  it('tells API paths from pages', () => {
    expect(isApiPath('/api/dashboard/export')).toBe(true);
    expect(isApiPath('/dashboard')).toBe(false);
    expect(isApiPath('/apix')).toBe(false);
  });
});

describe('login throttle', () => {
  it('blocks the 6th failure of an IP for 15 minutes, success resets', () => {
    const t = new LoginThrottle(5, 50, 15 * 60_000);
    for (let i = 0; i < 5; i += 1) {
      expect(t.check('1.1.1.1', i * 1000)).toBeNull();
      t.recordFailure('1.1.1.1', i * 1000);
    }
    const wait = t.check('1.1.1.1', 5_000);
    expect(wait).not.toBeNull();
    expect(wait).toBeLessThanOrEqual(15 * 60);
    expect(t.check('2.2.2.2', 5_000)).toBeNull();
    expect(t.check('1.1.1.1', 15 * 60_000 + 1_000)).toBeNull();
    t.reset('1.1.1.1');
    expect(t.check('1.1.1.1', 6_000)).toBeNull();
  });

  it('applies a global cap across IPs', () => {
    const t = new LoginThrottle(5, 3, 60_000);
    t.recordFailure('a', 0);
    t.recordFailure('b', 0);
    t.recordFailure('c', 0);
    expect(t.check('d', 1)).not.toBeNull();
  });
});
