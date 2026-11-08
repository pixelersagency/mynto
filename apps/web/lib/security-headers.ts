/**
 * Runtime security headers (set by middleware.ts, so they follow the
 * PUBLIC_URL of the running install instead of the build environment).
 * HSTS and upgrade-insecure-requests are only sent when the install is
 * served over HTTPS: on a plain-HTTP LAN install they would lock browsers
 * out.
 */

export function buildCsp(https: boolean): string {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/**
 * CSP of the /media/ routes (images, fonts, user-uploaded logo and
 * favicon). Never a document: if one is opened directly (an SVG favicon),
 * nothing runs and it cannot reach the origin.
 */
export const MEDIA_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export function securityHeaders(opts: {
  https: boolean;
  production: boolean;
  /** /media/ responses get MEDIA_CSP instead of the page CSP (in every environment). */
  media?: boolean;
}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (opts.media === true) headers['Content-Security-Policy'] = MEDIA_CSP;
  else if (opts.production) headers['Content-Security-Policy'] = buildCsp(opts.https);
  if (opts.production && opts.https) {
    headers['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains';
  }
  return headers;
}

export function isHttpsUrl(url: string | undefined): boolean {
  return typeof url === 'string' && url.startsWith('https://');
}
