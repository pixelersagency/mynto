import { describe, expect, it } from 'vitest';

import { AuditFullCreateRequestSchema } from './audit-full.js';

describe('AuditFullCreateRequestSchema', () => {
  it('accepts a url without email', () => {
    const result = AuditFullCreateRequestSchema.safeParse({ url: 'https://example.com' });
    expect(result.success).toBe(true);
  });

  it('accepts an optional contact email', () => {
    const result = AuditFullCreateRequestSchema.safeParse({
      url: 'https://example.com',
      email: 'contact@example.com',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a non-http protocol', () => {
    const result = AuditFullCreateRequestSchema.safeParse({ url: 'ftp://example.com' });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid email', () => {
    const result = AuditFullCreateRequestSchema.safeParse({
      url: 'https://example.com',
      email: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });
});
