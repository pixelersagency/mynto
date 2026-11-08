// @vitest-environment node
import { deflateSync } from 'node:zlib';

import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { containSquarePng } = await import('@/lib/favicon-render');
const { imageSize } = await import('@/lib/favicon');

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Valid opaque RGB PNG of the given size. */
function solidPng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x40)]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

describe('containSquarePng', () => {
  it('renders a wide logo as a square PNG', async () => {
    const out = await containSquarePng('test-wide', solidPng(60, 20), 'image/png', { size: 64 });
    expect(out).not.toBeNull();
    expect(imageSize(out ?? new Uint8Array())).toEqual({ width: 64, height: 64 });
  }, 20_000);

  it('refuses to decode an oversized image', async () => {
    const header = solidPng(1, 1);
    header.writeUInt32BE(10_000, 16);
    expect(await containSquarePng('test-huge', header, 'image/png', { size: 64 })).toBeNull();
  });
});
