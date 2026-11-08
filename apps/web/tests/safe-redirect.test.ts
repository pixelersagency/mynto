import { describe, expect, it } from 'vitest';

import { sanitizeNextPath } from '@/lib/safe-redirect';

describe('sanitizeNextPath', () => {
  it('accepts same-site absolute paths', () => {
    expect(sanitizeNextPath('/dashboard')).toBe('/dashboard');
    expect(sanitizeNextPath('/dashboard/sites?tab=active')).toBe('/dashboard/sites?tab=active');
    expect(sanitizeNextPath('/')).toBe('/');
  });

  it('rejects empty and missing values', () => {
    expect(sanitizeNextPath(null)).toBeNull();
    expect(sanitizeNextPath(undefined)).toBeNull();
    expect(sanitizeNextPath('')).toBeNull();
  });

  it('rejects absolute URLs and schemes', () => {
    expect(sanitizeNextPath('https://evil.com')).toBeNull();
    expect(sanitizeNextPath('http://evil.com')).toBeNull();
    expect(sanitizeNextPath('javascript:alert(1)')).toBeNull();
    expect(sanitizeNextPath('dashboard')).toBeNull();
  });

  it('rejects protocol-relative URLs', () => {
    expect(sanitizeNextPath('//evil.com')).toBeNull();
    expect(sanitizeNextPath('//evil.com/dashboard')).toBeNull();
  });

  it('rejects backslash open-redirect tricks', () => {
    expect(sanitizeNextPath('/\\evil.com')).toBeNull();
    expect(sanitizeNextPath('/\\/evil.com')).toBeNull();
    expect(sanitizeNextPath('/path\\to\\evil')).toBeNull();
  });

  it('rejects control chars (CR/LF header injection)', () => {
    expect(sanitizeNextPath('/dashboard\nSet-Cookie: x=1')).toBeNull();
    expect(sanitizeNextPath('/dashboard\r\n')).toBeNull();
    expect(sanitizeNextPath('/dashboard\x00')).toBeNull();
  });

  it('rejects over-long values', () => {
    expect(sanitizeNextPath(`/${'a'.repeat(512)}`)).toBeNull();
  });
});
