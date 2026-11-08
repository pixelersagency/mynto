import { describe, expect, it } from 'vitest';

import { detectStack } from '../src/audit/collectors/stack-detect.js';

describe('stack detection — SimpleBO + WP page builders', () => {
  it('detects SimpleBO from sbcdnsb.com asset', () => {
    const r = detectStack({
      html: '<script src="https://sbcdnsb.com/main.js"></script><body class="sb-page"></body>',
      responseHeaders: {},
    });
    expect(r.stack).toBe('simplebo');
    expect(r.confidence).toBeGreaterThan(0.3);
  });

  it('detects SimpleBO from simplebo.net script', () => {
    const r = detectStack({
      html: '<script src="https://app.simplebo.net/widget.js"></script>',
      responseHeaders: {},
    });
    expect(r.stack).toBe('simplebo');
  });

  it('detects WordPress + Bricks (variant beats plain WP)', () => {
    const r = detectStack({
      html: '<link href="/wp-content/plugins/bricks/style.css"><div class="brxe-section"></div>',
      responseHeaders: {},
    });
    expect(r.stack).toBe('wordpress_bricks');
  });

  it('detects WordPress + Elementor', () => {
    const r = detectStack({
      html: '<body class="elementor-default elementor-page-123"><link href="/wp-content/plugins/elementor/style.css">',
      responseHeaders: {},
    });
    expect(r.stack).toBe('wordpress_elementor');
  });

  it('detects WordPress + Divi', () => {
    const r = detectStack({
      html: '<link href="/wp-content/themes/Divi/style.css"><div class="et_pb_section"></div>',
      responseHeaders: {},
    });
    expect(r.stack).toBe('wordpress_divi');
  });

  it('falls back to plain wordpress when builder signature is absent', () => {
    const r = detectStack({
      html: '<link href="/wp-content/themes/twentytwentyfour/style.css"><script src="/wp-includes/js/jquery.js"></script>',
      responseHeaders: {},
      generatorMeta: 'WordPress 6.5',
    });
    expect(r.stack).toBe('wordpress');
  });

  it('still returns unknown on plain HTML with no signal', () => {
    const r = detectStack({
      html: '<html><body><p>nothing</p></body></html>',
      responseHeaders: {},
    });
    expect(r.stack).toBe('unknown');
  });
});
