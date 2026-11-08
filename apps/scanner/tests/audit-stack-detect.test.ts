import { describe, expect, it } from 'vitest';

import { detectStack } from '../src/audit/collectors/stack-detect.js';

describe('stack detection', () => {
  it('detects WordPress from wp-content + generator meta', () => {
    const r = detectStack({
      html: '<link rel="stylesheet" href="/wp-content/themes/x/style.css"><script src="/wp-includes/js/jquery.js"></script>',
      responseHeaders: {},
      generatorMeta: 'WordPress 6.4',
    });
    expect(r.stack).toBe('wordpress');
    expect(r.confidence).toBeGreaterThan(0.5);
  });

  it('detects Shopify from header', () => {
    const r = detectStack({
      html: '<link rel="canonical" href="https://shop.myshopify.com">',
      responseHeaders: { 'x-shopify-stage': 'production', 'powered-by': 'Shopify' },
    });
    expect(r.stack).toBe('shopify');
  });

  it('detects Next.js from __NEXT_DATA__ and x-nextjs-prerender', () => {
    const r = detectStack({
      html: '<script id="__NEXT_DATA__" type="application/json">{}</script><script src="/_next/static/abc.js"></script>',
      responseHeaders: { 'x-powered-by': 'Next.js', 'x-nextjs-prerender': '1' },
    });
    expect(r.stack).toBe('nextjs');
  });

  it('detects Framer', () => {
    const r = detectStack({
      html: '<img src="https://framerusercontent.com/x.png"><meta name="framer-search-index" content="x">',
      responseHeaders: {},
      generatorMeta: 'Framer',
    });
    expect(r.stack).toBe('framer');
  });

  it('returns unknown when no signal matches', () => {
    const r = detectStack({
      html: '<html><body>nothing here</body></html>',
      responseHeaders: {},
    });
    expect(r.stack).toBe('unknown');
    expect(r.confidence).toBe(0);
  });
});
