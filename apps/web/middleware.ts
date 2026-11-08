import { NextResponse, type NextRequest } from 'next/server';

import { isApiPath, isPublicPath } from './lib/auth/paths';
import { SESSION_COOKIE, verifySession } from './lib/auth/session';
import { sanitizeNextPath } from './lib/safe-redirect';
import { isHttpsUrl, securityHeaders } from './lib/security-headers';

/**
 * 1. Auth gate, deny by default (lib/auth/paths.ts): anonymous requests to
 *    anything outside the public allowlist get a redirect to /login (pages)
 *    or a 401 (API). Pages and server actions check the session again.
 * 2. Runtime security headers (CSP, HSTS only when PUBLIC_URL is https).
 *
 * Node.js runtime so the env is read at request time (self-hosted image,
 * same build for every agency).
 */
export async function middleware(req: NextRequest): Promise<NextResponse> {
  const { pathname, search } = req.nextUrl;
  let res: NextResponse;

  if (isPublicPath(pathname, req.method)) {
    res = NextResponse.next();
  } else {
    const session = await verifySession(
      req.cookies.get(SESSION_COOKIE)?.value,
      process.env.SESSION_SECRET,
      { expectedEmail: process.env.ADMIN_EMAIL },
    );
    if (session !== null) {
      res = NextResponse.next();
    } else if (isApiPath(pathname)) {
      res = NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    } else {
      const url = req.nextUrl.clone();
      url.pathname = '/login';
      url.search = '';
      const next = sanitizeNextPath(`${pathname}${search}`);
      if (next !== null && next !== '/') url.searchParams.set('next', next);
      res = NextResponse.redirect(url);
    }
  }

  const https = isHttpsUrl(process.env.PUBLIC_URL ?? process.env.NEXT_PUBLIC_APP_URL);
  for (const [k, v] of Object.entries(
    securityHeaders({
      https,
      production: process.env.NODE_ENV === 'production',
      media: pathname.startsWith('/media/'),
    }),
  )) {
    res.headers.set(k, v);
  }
  return res;
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image).*)'],
};
