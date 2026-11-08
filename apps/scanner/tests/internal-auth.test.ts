import { describe, expect, it } from 'vitest';

import { defaultAuditUserAgent, auditUserAgent } from '../src/audit/user-agent.js';
import { INTERNAL_TOKEN_HEADER, verifyInternalToken } from '../src/lib/internal-token.js';

describe('verifyInternalToken', () => {
  const secret = 's'.repeat(40);

  it('accepts the exact token only', () => {
    expect(verifyInternalToken(secret, secret)).toBe(true);
    expect(verifyInternalToken([secret, 'x'], secret)).toBe(true);
    expect(verifyInternalToken(`${secret}x`, secret)).toBe(false);
    expect(verifyInternalToken(secret.slice(1), secret)).toBe(false);
  });

  it('refuses everything when no token is configured', () => {
    expect(verifyInternalToken('', '')).toBe(false);
    expect(verifyInternalToken('anything', undefined)).toBe(false);
    expect(verifyInternalToken(undefined, secret)).toBe(false);
    expect(verifyInternalToken('x'.repeat(600), secret)).toBe(false);
  });

  it('uses a lower-case header name (Node lower-cases incoming headers)', () => {
    expect(INTERNAL_TOKEN_HEADER).toBe(INTERNAL_TOKEN_HEADER.toLowerCase());
  });
});

describe('audit bot User-Agent', () => {
  it('names the tool and the install URL', () => {
    expect(defaultAuditUserAgent('https://audit.agence.fr/', '1.2.3')).toBe(
      'Mozilla/5.0 (compatible; MyntoAudit/1.2.3; +https://audit.agence.fr)',
    );
    expect(defaultAuditUserAgent(undefined, '1.2.3')).toBe(
      'Mozilla/5.0 (compatible; MyntoAudit/1.2.3)',
    );
  });

  it('PUBLIC_URL wins over WEB_BASE_URL; AUDIT_USER_AGENT overrides all', () => {
    expect(
      auditUserAgent({ PUBLIC_URL: 'https://a.fr', WEB_BASE_URL: 'http://web:3000' }),
    ).toContain('+https://a.fr)');
    expect(auditUserAgent({ WEB_BASE_URL: 'http://web:3000' })).toContain('+http://web:3000)');
    expect(auditUserAgent({ AUDIT_USER_AGENT: 'MonBot/1.0\r\nX-Evil: 1' })).toBe(
      'MonBot/1.0X-Evil: 1',
    );
  });
});
