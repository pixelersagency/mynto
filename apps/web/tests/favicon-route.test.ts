// @vitest-environment node
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const settingsGet = vi.fn();
const mediaGet = vi.fn();
vi.mock('@/lib/db', () => ({
  db: () => ({ settings: { get: settingsGet } }),
  getMediaStorage: () => ({ get: mediaGet }),
  pgErrorCode: () => 'test',
}));

const containSquarePng = vi.fn();
vi.mock('@/lib/favicon-render', () => ({
  containSquarePng,
  defaultAppleIconPng: vi.fn(() => Promise.resolve(Buffer.from('DEFAULT-APPLE'))),
}));

const { GET: faviconGET } = await import('../app/media/brand/favicon/route');
const { GET: appleGET } = await import('../app/media/brand/apple-icon/route');
const { MEDIA_CSP, securityHeaders } = await import('../lib/security-headers');

describe('media CSP', () => {
  it('replaces the page CSP on /media/ responses, in every environment', () => {
    for (const production of [true, false]) {
      expect(securityHeaders({ https: true, production, media: true })).toMatchObject({
        'Content-Security-Policy': MEDIA_CSP,
      });
    }
    expect(MEDIA_CSP).toContain('sandbox');
    expect(MEDIA_CSP).not.toContain('script-src');
    expect(
      securityHeaders({ https: false, production: true })['Content-Security-Policy'],
    ).toContain("default-src 'self'");
  });
});

function pngHeader(width: number, height: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(b, 0);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>',
);
const FAV_SVG = 'brand/favicon-aaaaaaaa.svg';
const FAV_PNG = 'brand/favicon-bbbbbbbb.png';
const LOGO = 'brand/logo-cccccccc.png';

function req(path: string): NextRequest {
  return new NextRequest(new URL(path, 'http://localhost:3000'));
}

function settings(keys: { favicon_key?: string | null; logo_key?: string | null }): void {
  settingsGet.mockResolvedValue({ favicon_key: null, logo_key: null, ...keys });
}

beforeEach(() => {
  settingsGet.mockReset();
  mediaGet.mockReset();
  containSquarePng.mockReset();
  containSquarePng.mockResolvedValue(Buffer.from('FITTED'));
});

describe('GET /media/brand/favicon', () => {
  it('serves the agency favicon as is, cached for long on the current version', async () => {
    settings({ favicon_key: FAV_SVG, logo_key: LOGO });
    mediaGet.mockResolvedValue(SVG);
    const res = await faviconGET(req('/media/brand/favicon?v=faaaaaaaa'));
    expect(res.status).toBe(200);
    expect(mediaGet).toHaveBeenCalledWith(FAV_SVG);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(Buffer.from(await res.arrayBuffer()).equals(SVG)).toBe(true);
  });

  it('uses a short cache for an unversioned or outdated URL', async () => {
    settings({ favicon_key: FAV_SVG });
    mediaGet.mockResolvedValue(SVG);
    const noV = await faviconGET(req('/media/brand/favicon'));
    expect(noV.headers.get('cache-control')).toBe('public, max-age=300');
    const old = await faviconGET(req('/media/brand/favicon?v=lzzzzzzzz'));
    expect(old.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('falls back to the logo, fitted on a square', async () => {
    settings({ logo_key: LOGO });
    mediaGet.mockResolvedValue(pngHeader(600, 200));
    const res = await faviconGET(req('/media/brand/favicon?v=lcccccccc'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(containSquarePng).toHaveBeenCalledWith(LOGO, expect.anything(), 'image/png', {
      size: 256,
    });
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('FITTED');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('serves a square PNG favicon without re-encoding it', async () => {
    settings({ favicon_key: FAV_PNG });
    const png = pngHeader(512, 512);
    mediaGet.mockResolvedValue(png);
    const res = await faviconGET(req('/media/brand/favicon?v=fbbbbbbbb'));
    expect(containSquarePng).not.toHaveBeenCalled();
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);
  });

  it('serves the logo as is when it cannot be fitted', async () => {
    settings({ logo_key: LOGO });
    const png = pngHeader(600, 200);
    mediaGet.mockResolvedValue(png);
    containSquarePng.mockResolvedValue(null);
    const res = await faviconGET(req('/media/brand/favicon?v=lcccccccc'));
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);
  });

  it('skips a missing favicon file and does not cache that answer for long', async () => {
    settings({ favicon_key: FAV_SVG, logo_key: LOGO });
    mediaGet.mockImplementation((key: string) =>
      Promise.resolve(key === LOGO ? pngHeader(64, 64) : null),
    );
    const res = await faviconGET(req('/media/brand/favicon?v=faaaaaaaa'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('serves the default icon without favicon nor logo', async () => {
    settings({});
    const res = await faviconGET(req('/media/brand/favicon?v=default'));
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(await res.text()).toContain('<svg');
    expect(mediaGet).not.toHaveBeenCalled();
  });

  it('serves the default icon, briefly cached, when the database is down', async () => {
    settingsGet.mockRejectedValue(new Error('down'));
    const res = await faviconGET(req('/media/brand/favicon?v=default'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
  });
});

describe('GET /media/brand/apple-icon', () => {
  it('fits a PNG favicon on a white 180 px square', async () => {
    settings({ favicon_key: FAV_PNG, logo_key: LOGO });
    mediaGet.mockResolvedValue(pngHeader(512, 512));
    const res = await appleGET(req('/media/brand/apple-icon?v=fbbbbbbbb'));
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(containSquarePng).toHaveBeenCalledWith(FAV_PNG, expect.anything(), 'image/png', {
      size: 180,
      padding: 0.08,
      background: '#ffffff',
    });
  });

  it('uses the logo when the favicon is an SVG, 404 without any raster source', async () => {
    settings({ favicon_key: FAV_SVG, logo_key: LOGO });
    mediaGet.mockResolvedValue(pngHeader(64, 64));
    const res = await appleGET(req('/media/brand/apple-icon?v=lcccccccc'));
    expect(res.status).toBe(200);
    expect(mediaGet).toHaveBeenCalledWith(LOGO);

    settings({ favicon_key: FAV_SVG });
    const none = await appleGET(req('/media/brand/apple-icon'));
    expect(none.status).toBe(404);
  });

  it('serves the default touch icon without any agency icon', async () => {
    settings({});
    const res = await appleGET(req('/media/brand/apple-icon?v=default'));
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('DEFAULT-APPLE');
  });
});
