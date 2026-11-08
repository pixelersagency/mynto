import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Media store for binary artefacts (hero screenshots). Only a local
 * filesystem implementation exists; the interface is kept small so an
 * S3-compatible store can be added later without touching the callers.
 *
 * Keys are relative POSIX paths such as `hero/<auditId>.png`. The DB
 * stores the key, never an absolute URL, so the public URL can change
 * (other host, CDN, S3) without a data migration.
 */
export interface MediaStorage {
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  /** Bytes of the object, or null when it does not exist. */
  get(key: string): Promise<Buffer | null>;
  /** Removes the object. Missing objects are not an error. */
  delete(key: string): Promise<void>;
  /** URL the browser uses to load the object (relative to the web app). */
  getUrl(key: string): string;
}

export const DEFAULT_MEDIA_DIR = '/data/media';

/** Public URL prefix served by the web app (apps/web/app/media). */
export const MEDIA_URL_PREFIX = '/media/';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lower-case canonical UUID check, shared by the scanner and the web route. */
export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/** Media key of the hero screenshot of an audit. Throws on a non-UUID id. */
export function heroKey(auditId: string): string {
  if (!isUuid(auditId)) throw new Error('heroKey: invalid audit id');
  return `hero/${auditId.toLowerCase()}.png`;
}

/** Public URL of a media key (no I/O). */
export function mediaUrl(key: string): string {
  return `${MEDIA_URL_PREFIX}${key}`;
}

const SAFE_KEY = /^[a-z0-9]+(?:\/[a-z0-9][a-z0-9._-]*)+$/i;

function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.split('/').some((s) => s === '..' || s === '.')) {
    throw new Error('media: invalid key');
  }
}

export class LocalMediaStorage implements MediaStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.root, key);
    // Defense in depth on top of the key regex.
    if (!full.startsWith(this.root + path.sep)) throw new Error('media: key escapes root');
    return full;
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<void> {
    const full = this.resolve(key);
    await mkdir(path.dirname(full), { recursive: true });
    // Write then rename so a reader never sees a half-written file.
    const tmp = `${full}.${String(process.pid)}.${String(Date.now())}.tmp`;
    await writeFile(tmp, data);
    await rename(tmp, full);
  }

  async get(key: string): Promise<Buffer | null> {
    const full = this.resolve(key);
    try {
      return await readFile(full);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }

  getUrl(key: string): string {
    assertSafeKey(key);
    return mediaUrl(key);
  }
}

let shared: MediaStorage | null = null;

/** Process-wide media store from MEDIA_DIR (default /data/media). */
export function getMediaStorage(): MediaStorage {
  if (shared !== null) return shared;
  const dir = process.env.MEDIA_DIR;
  shared = new LocalMediaStorage(dir !== undefined && dir.length > 0 ? dir : DEFAULT_MEDIA_DIR);
  return shared;
}

/** Fresh media key for an uploaded agency logo (random so URLs bust caches). */
export function newBrandLogoKey(ext: 'png' | 'jpg', random: string): string {
  const id = random
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24);
  if (id.length < 8) throw new Error('newBrandLogoKey: random part too short');
  return `brand/logo-${id}.${ext}`;
}

/** Fresh media key for an uploaded agency favicon (random so URLs bust caches). */
export function newBrandFaviconKey(ext: 'png' | 'svg' | 'ico', random: string): string {
  const id = random
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24);
  if (id.length < 8) throw new Error('newBrandFaviconKey: random part too short');
  return `brand/favicon-${id}.${ext}`;
}
