import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { LocalMediaStorage, heroKey, isUuid, mediaUrl } from '../src/media.js';

const ID = '3f2b8c1e-9a4d-4c2b-8f1e-0123456789ab';

describe('LocalMediaStorage', () => {
  let dir: string;
  let store: LocalMediaStorage;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'mynto-media-'));
    store = new LocalMediaStorage(dir);
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('round-trips a hero file and deletes it', async () => {
    const key = heroKey(ID);
    expect(key).toBe(`hero/${ID}.png`);
    await store.put(key, Buffer.from('png-bytes'), 'image/png');
    expect((await store.get(key))?.toString()).toBe('png-bytes');
    expect(store.getUrl(key)).toBe(`/media/hero/${ID}.png`);
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    await store.delete(key); // idempotent
  });

  it('rejects traversal and odd keys', async () => {
    await expect(store.put('../x.png', Buffer.from(''), 'image/png')).rejects.toThrow();
    await expect(store.get('hero/../../etc/passwd')).rejects.toThrow();
    await expect(store.get('/abs/path.png')).rejects.toThrow();
    expect(() => heroKey('not-a-uuid')).toThrow();
  });

  it('helpers', () => {
    expect(isUuid(ID)).toBe(true);
    expect(isUuid(`${ID}.png`)).toBe(false);
    expect(mediaUrl('hero/a.png')).toBe('/media/hero/a.png');
  });
});
