import { getServerEnv } from './env';

/**
 * Client IP for rate-limiting, derived only from values a trusted proxy
 * wrote.
 *
 * A caller can send any `X-Forwarded-For`, `CF-Connecting-IP` or
 * `X-Vercel-Forwarded-For` it likes, and the scanner keys its per-IP
 * limit on what we forward. Reading those headers as-is therefore hands
 * the caller a one-header bypass of the audit rate limit.
 *
 * What is trustworthy depends on the deployment:
 *   - the reverse proxy in front of the app (Caddy, Traefik, nginx...)
 *     appends the real peer to `X-Forwarded-For`, so the LAST entry is
 *     ours and everything before it is caller-supplied noise;
 *   - `X-Real-IP` is set by that same proxy, overwriting any client value;
 *   - `CF-Connecting-IP` is only meaningful once Cloudflare fronts the
 *     traffic, hence the explicit `CDN_TRUST_MODE=cloudflare` opt-in.
 *
 * Returns null when nothing trustworthy is present; callers must treat
 * that as "unknown", never as a free pass.
 */
export function trustedClientIp(headers: Headers): string | null {
  const env = getServerEnv();

  if (env.CDN_TRUST_MODE === 'cloudflare') {
    const cf = headers.get('cf-connecting-ip');
    if (cf !== null && cf.trim().length > 0) return cf.trim();
  }

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded !== null) {
    const hops = forwarded
      .split(',')
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    const last = hops.at(-1);
    if (last !== undefined) return last;
  }

  const real = headers.get('x-real-ip');
  if (real !== null && real.trim().length > 0) return real.trim();

  return null;
}
