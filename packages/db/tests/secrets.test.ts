import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  DecryptionError,
  EncryptionKeyInvalidError,
  EncryptionKeyMissingError,
  decryptSecret,
  encryptSecret,
  hasValidMasterKey,
  maskSecret,
  parseMasterKey,
} from '../src/secrets.js';

const B64 = randomBytes(32).toString('base64');
const HEX = randomBytes(32).toString('hex');

describe('secrets (AES-256-GCM)', () => {
  it('parses base64 and hex master keys, rejects the rest', () => {
    expect(parseMasterKey(B64)).toHaveLength(32);
    expect(parseMasterKey(HEX)).toHaveLength(32);
    expect(() => parseMasterKey(undefined)).toThrow(EncryptionKeyMissingError);
    expect(() => parseMasterKey('')).toThrow(EncryptionKeyMissingError);
    expect(() => parseMasterKey('short')).toThrow(EncryptionKeyInvalidError);
    expect(() => parseMasterKey(randomBytes(16).toString('hex'))).toThrow(
      EncryptionKeyInvalidError,
    );
    expect(hasValidMasterKey(B64)).toBe(true);
    expect(hasValidMasterKey('nope')).toBe(false);
  });

  it('round-trips, with a random IV each time', () => {
    const a = encryptSecret('sk-ant-secret-value-1234', B64, 'anthropic');
    const b = encryptSecret('sk-ant-secret-value-1234', B64, 'anthropic');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1.')).toBe(true);
    expect(a).not.toContain('secret');
    expect(decryptSecret(a, B64, 'anthropic')).toBe('sk-ant-secret-value-1234');
  });

  it('fails on wrong key, wrong AAD (provider) or tampering', () => {
    const c = encryptSecret('value-abcdefgh', HEX, 'gemini');
    expect(() => decryptSecret(c, B64, 'gemini')).toThrow(DecryptionError);
    expect(() => decryptSecret(c, HEX, 'mistral')).toThrow(DecryptionError);
    const parts = c.split('.');
    const tampered = [parts[0], parts[1], parts[2], `${parts[3] ?? ''}AA`].join('.');
    expect(() => decryptSecret(tampered, HEX, 'gemini')).toThrow(DecryptionError);
    expect(() => decryptSecret('garbage', HEX, 'gemini')).toThrow(DecryptionError);
  });

  it('masks keys without revealing them', () => {
    expect(maskSecret('sk-ant-api03-abcdefghijklmnop-wxyz')).toBe('sk-…wxyz');
    expect(maskSecret('shortkey9')).toBe('…key9');
  });
});
