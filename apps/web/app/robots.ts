import type { MetadataRoute } from 'next';

/**
 * Self-hosted internal tool: nothing on this instance is meant to be
 * crawled or indexed. Report pages and /r/ tracking links carry per-page
 * noindex meta on top of this.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
