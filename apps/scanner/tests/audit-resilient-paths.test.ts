import { describe, expect, it } from 'vitest';

import { buildCandidates } from '../src/audit/collectors/resilient-paths.js';

describe('resilient path candidates', () => {
  it('prioritises wordpress sitemap on WP stacks', () => {
    const list = buildCandidates('https://example.com', 'sitemap', { stack: 'wordpress' });
    const wp = list.findIndex((u) => u.endsWith('/wp-sitemap.xml'));
    const standard = list.findIndex((u) => u.endsWith('/sitemap.xml'));
    expect(wp).toBeGreaterThanOrEqual(0);
    expect(wp).toBeLessThan(standard);
  });

  it('prioritises Shopify split sitemaps on Shopify stacks', () => {
    const list = buildCandidates('https://example.com', 'sitemap', { stack: 'shopify' });
    expect(list.some((u) => u.includes('sitemap_products_1.xml'))).toBe(true);
  });

  it('falls back to standard locations on unknown stacks', () => {
    const list = buildCandidates('https://example.com', 'sitemap', {});
    expect(list[0]).toBe('https://example.com/sitemap.xml');
    expect(list).toContain('https://example.com/sitemap_index.xml');
    expect(list).toContain('https://example.com/sitemap.xml.gz');
  });

  it('uses FR slugs for mentions légales', () => {
    const list = buildCandidates('https://example.com', 'mentions_legales', {});
    expect(list).toContain('https://example.com/mentions-legales');
    expect(list).toContain('https://example.com/legal');
    expect(list).toContain('https://example.com/impressum');
  });

  it('uses FR slugs for privacy with multiple variants', () => {
    const list = buildCandidates('https://example.com', 'privacy', {});
    expect(list).toContain('https://example.com/politique-de-confidentialite');
    expect(list).toContain('https://example.com/privacy');
    expect(list).toContain('https://example.com/donnees-personnelles');
    expect(list).toContain('https://example.com/rgpd');
  });

  it('seeds candidates from known links when provided', () => {
    const list = buildCandidates('https://example.com', 'privacy', {
      knownLinks: [
        'https://example.com/notre-politique-de-confidentialite-2024',
        'https://example.com/about',
      ],
    });
    expect(list[0]).toBe('https://example.com/notre-politique-de-confidentialite-2024');
  });

  it('uses FR/EN variants for pricing', () => {
    const list = buildCandidates('https://example.com', 'pricing', {});
    expect(list).toContain('https://example.com/pricing');
    expect(list).toContain('https://example.com/tarifs');
    expect(list).toContain('https://example.com/abonnement');
  });
});
