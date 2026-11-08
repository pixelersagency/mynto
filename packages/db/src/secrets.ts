import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Encryption at rest of the AI provider keys (AES-256-GCM).
 *
 * The master secret is APP_ENCRYPTION_KEY: 32 random bytes, written as
 * base64 (44 chars) or hex (64 chars). Generate it with
 * `openssl rand -base64 32`. The AES key is derived from it with HKDF-SHA256
 * (fixed info string), so the same secret could later serve other purposes
 * without key reuse.
 *
 * Stored format: "v1.<iv>.<tag>.<ciphertext>", base64url parts, 12-byte
 * random IV, 16-byte tag. The provider name is bound as AAD: a ciphertext
 * copied to another provider row fails to decrypt.
 *
 * Nothing here ever logs a key or a plaintext.
 */

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super('APP_ENCRYPTION_KEY is not set');
    this.name = 'EncryptionKeyMissingError';
  }
}

export class EncryptionKeyInvalidError extends Error {
  constructor() {
    super('APP_ENCRYPTION_KEY must be 32 bytes, base64 (44 chars) or hex (64 chars)');
    this.name = 'EncryptionKeyInvalidError';
  }
}

export class DecryptionError extends Error {
  constructor() {
    super('stored secret cannot be decrypted (wrong APP_ENCRYPTION_KEY or corrupted value)');
    this.name = 'DecryptionError';
  }
}

const VERSION = 'v1';
const INFO = 'mynto:ai-provider-keys:v1';

/** Parses APP_ENCRYPTION_KEY into its 32 raw bytes. */
export function parseMasterKey(raw: string | undefined | null): Buffer {
  if (raw === undefined || raw === null || raw.trim() === '') throw new EncryptionKeyMissingError();
  const v = raw.trim();
  let bytes: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(v)) bytes = Buffer.from(v, 'hex');
  else if (/^[A-Za-z0-9+/_-]{43}={0,1}$/.test(v)) {
    bytes = Buffer.from(v.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  }
  if (bytes?.length !== 32) throw new EncryptionKeyInvalidError();
  return bytes;
}

/** True when APP_ENCRYPTION_KEY is set and well formed. */
export function hasValidMasterKey(raw: string | undefined | null): boolean {
  try {
    parseMasterKey(raw);
    return true;
  } catch {
    return false;
  }
}

function deriveKey(master: Buffer): Buffer {
  return Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), INFO, 32));
}

const b64u = (b: Buffer): string => b.toString('base64url');

export function encryptSecret(
  plaintext: string,
  masterRaw: string | undefined,
  aad: string,
): string {
  const key = deriveKey(parseMasterKey(masterRaw));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return [VERSION, b64u(iv), b64u(cipher.getAuthTag()), b64u(ct)].join('.');
}

export function decryptSecret(stored: string, masterRaw: string | undefined, aad: string): string {
  const key = deriveKey(parseMasterKey(masterRaw));
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new DecryptionError();
  try {
    const iv = Buffer.from(parts[1] ?? '', 'base64url');
    const tag = Buffer.from(parts[2] ?? '', 'base64url');
    const ct = Buffer.from(parts[3] ?? '', 'base64url');
    if (iv.length !== 12 || tag.length !== 16) throw new DecryptionError();
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new DecryptionError();
  }
}

/** Masked display form: "sk-…abcd" (first 3 + last 4) or "…abcd" for short keys. */
export function maskSecret(secret: string): string {
  const s = secret.trim();
  const tail = s.slice(-4);
  return s.length >= 16 ? `${s.slice(0, 3)}…${tail}` : `…${tail}`;
}

/** SHA-256 hex (API key hashes: the keys are 256-bit random, no salt needed). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
