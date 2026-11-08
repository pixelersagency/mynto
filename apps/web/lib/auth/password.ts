import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

/**
 * Admin password hashing with Node's built-in scrypt (memory-hard KDF).
 *
 * Stored format (ADMIN_PASSWORD_HASH):
 *   scrypt:<N>:<r>:<p>:<salt base64url>:<key base64url>
 * Produced by `pnpm admin:hash-password` (scripts/hash-password.mjs, same
 * parameters). Parameters live in the string so they can be raised later
 * without invalidating existing hashes.
 */

export const SCRYPT_DEFAULTS = { N: 2 ** 15, r: 8, p: 1, keyLen: 32, saltLen: 16 } as const;

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function scrypt(
  password: string,
  salt: Buffer,
  keyLen: number,
  opts: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem: 128 * N * r * 2 covers the parameters with headroom.
    scryptCb(
      password.normalize('NFKC'),
      salt,
      keyLen,
      { ...opts, maxmem: 256 * opts.N * opts.r + 1024 * 1024 },
      (err, key) => {
        if (err) reject(err);
        else resolve(key);
      },
    );
  });
}

export function parseScryptHash(stored: string): ParsedHash | null {
  const parts = stored.trim().split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, n, r, p, saltB64, keyB64] = parts as [string, string, string, string, string, string];
  const N = Number(n);
  const R = Number(r);
  const P = Number(p);
  const isPow2 = Number.isInteger(N) && N >= 2 ** 14 && N <= 2 ** 20 && (N & (N - 1)) === 0;
  if (!isPow2 || !Number.isInteger(R) || R < 1 || R > 32 || !Number.isInteger(P) || P < 1 || P > 16)
    return null;
  const salt = Buffer.from(saltB64, 'base64url');
  const key = Buffer.from(keyB64, 'base64url');
  if (salt.length < 16 || key.length < 32 || key.length > 64) return null;
  return { N, r: R, p: P, salt, key };
}

export async function hashPassword(password: string): Promise<string> {
  const { N, r, p, keyLen, saltLen } = SCRYPT_DEFAULTS;
  const salt = randomBytes(saltLen);
  const key = await scrypt(password, salt, keyLen, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join(':');
}

/** Constant-time verification against a stored scrypt hash. False on any malformed hash. */
export async function verifyPasswordHash(password: string, stored: string): Promise<boolean> {
  const parsed = parseScryptHash(stored);
  if (parsed === null) return false;
  const key = await scrypt(password, parsed.salt, parsed.key.length, parsed);
  return timingSafeEqual(key, parsed.key);
}

function sha256(s: string): Buffer {
  return createHash('sha256').update(s.normalize('NFKC')).digest();
}

/**
 * Constant-time comparison of two strings of any length (hash first so
 * timingSafeEqual sees equal lengths and leaks neither length nor content).
 */
export function constantTimeEqualStrings(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}
