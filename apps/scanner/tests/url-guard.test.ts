import { describe, expect, it } from 'vitest';

import { checkUrlSafe, normalizeUrl } from '../src/lib/url-guard.js';

describe('normalizeUrl', () => {
  it('lowercases hostname', () => {
    expect(normalizeUrl('https://Example.COM/path')).toBe('https://example.com/path');
  });

  it('strips search and hash', () => {
    expect(normalizeUrl('https://example.com/a?x=1#frag')).toBe('https://example.com/a');
  });

  it('strips trailing slash on root', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
  });

  it('keeps trailing slash on non-root paths intact', () => {
    expect(normalizeUrl('https://example.com/a/')).toBe('https://example.com/a/');
  });

  it('returns null for invalid URL', () => {
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('checkUrlSafe', () => {
  it('rejects file:// protocol', async () => {
    const r = await checkUrlSafe('file:///etc/passwd');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/blocked_protocol/);
  });

  it('rejects javascript: protocol', async () => {
    const r = await checkUrlSafe('javascript:alert(1)');
    expect(r.ok).toBe(false);
  });

  it('rejects data: protocol', async () => {
    const r = await checkUrlSafe('data:text/html,<script>alert(1)</script>');
    expect(r.ok).toBe(false);
  });

  it('rejects URLs with inline auth', async () => {
    const r = await checkUrlSafe('http://user:pass@example.com/');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('auth_in_url');
  });

  it('rejects non-standard ports', async () => {
    const r = await checkUrlSafe('http://example.com:8080/');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/blocked_port/);
  });

  it('accepts port 443 explicit on https', async () => {
    const r = await checkUrlSafe('https://example.com:443/');
    expect(r.ok).toBe(true);
  });

  it('rejects localhost hostname', async () => {
    const r = await checkUrlSafe('http://localhost/');
    expect(r.ok).toBe(false);
  });

  it('rejects 127.0.0.1 IP literal', async () => {
    const r = await checkUrlSafe('http://127.0.0.1/');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('private_ip_literal');
  });

  it('rejects 10.0.0.1 IP literal', async () => {
    const r = await checkUrlSafe('http://10.0.0.1/');
    expect(r.ok).toBe(false);
  });

  it('rejects 192.168.1.1 IP literal', async () => {
    const r = await checkUrlSafe('http://192.168.1.1/');
    expect(r.ok).toBe(false);
  });

  it('rejects 169.254.169.254 (cloud metadata)', async () => {
    const r = await checkUrlSafe('http://169.254.169.254/');
    expect(r.ok).toBe(false);
  });

  it('rejects ::1 IPv6 literal', async () => {
    const r = await checkUrlSafe('http://[::1]/');
    expect(r.ok).toBe(false);
  });

  it('rejects .internal hostname', async () => {
    const r = await checkUrlSafe('http://service.internal/');
    expect(r.ok).toBe(false);
  });

  it('accepts a plausible public URL (example.com)', async () => {
    const r = await checkUrlSafe('https://example.com/');
    expect(r.ok).toBe(true);
  });
});
