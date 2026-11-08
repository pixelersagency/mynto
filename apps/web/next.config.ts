import path from 'node:path';

import type { NextConfig } from 'next';

// CSP and HSTS are set at runtime by middleware.ts (they depend on
// PUBLIC_URL, which a prebuilt image only knows when it starts).

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  // @mynto/db (and its postgres.js driver) is bundled into the server
  // chunks only: lib/db is `server-only`, so a client import fails the build.
  transpilePackages: ['@mynto/shared', '@mynto/db', '@mynto/mcp'],
  // Node-only client of the shared API rate limit, loaded as is at runtime.
  serverExternalPackages: ['ioredis'],
  poweredByHeader: false,
  typedRoutes: true,
  webpack(config: { resolve?: { extensionAlias?: Record<string, string[]> } }) {
    config.resolve ??= {};
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // The dashboard and the login page are private.
        source: '/:area(dashboard|login)/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'private, no-store' },
        ],
      },
      {
        // Radar prospect links: private per-prospect tokens. Never indexed,
        // and the token never leaks through the Referer of outbound links.
        // Declared after the catch-all so these values win.
        source: '/r/:path*',
        headers: [
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive, nosnippet' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
        ],
      },
    ]);
  },
};

export default nextConfig;
