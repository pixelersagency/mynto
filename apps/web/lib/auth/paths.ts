/**
 * Route access policy, deny by default: everything needs the admin session
 * except the public allowlist below. Used by middleware.ts; every server
 * action and protected route handler also checks the session itself
 * (middleware is never the only gate).
 */

const PUBLIC_EXACT = new Set([
  '/login',
  '/api/health',
  '/robots.txt',
  '/favicon.ico',
  // MCP server (Streamable HTTP): own Bearer API key check in the route.
  '/mcp',
]);

const PUBLIC_PREFIXES = [
  // Public reports, their PDF view and OG image.
  '/audit/full/',
  // Tracking links.
  '/r/',
  // Report media (hero screenshots, agency logo and favicon, site favicons, custom fonts).
  '/media/hero/',
  '/media/brand/',
  '/media/favicon/',
  '/media/fonts/',
  // Bundled report fonts (public/fonts, woff2).
  '/fonts/',
  // Radar API: own Bearer key checked by the scanner; the view beacon is public.
  '/api/radar/',
  // Public REST API v1: own Bearer API key check in every route
  // (lib/api/auth.ts); /api/v1/openapi.json is public on purpose.
  '/api/v1/',
] as const;

/** Public report API: GET / HEAD only (summary, findings, PDF). */
const PUBLIC_REPORT_API = /^\/api\/audits\/full\/[A-Za-z0-9_-]{1,64}(?:\/findings|\/pdf)?\/?$/;

export function isPublicPath(pathname: string, method: string): boolean {
  if (pathname.includes('..') || pathname.includes('//') || pathname.includes('\\')) return false;
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  const m = method.toUpperCase();
  return (m === 'GET' || m === 'HEAD') && PUBLIC_REPORT_API.test(pathname);
}

/** API paths answer 401 JSON; pages redirect to /login. */
export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}
