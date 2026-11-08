import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ICON_SVG,
  FAVICON_MAX_BYTES,
  appleIconSources,
  checkFavicon,
  containBox,
  faviconContentType,
  faviconSources,
  iconLinks,
  iconVersion,
  imageSize,
} from '@/lib/favicon';

function pngHeader(width: number, height: number): Uint8Array {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

function jpegHeader(width: number, height: number): Uint8Array {
  // SOI, APP0 (length 16), SOF0 (length 17).
  const b = new Uint8Array(2 + 18 + 19);
  b.set([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const sof = 20;
  b.set([0xff, 0xc0, 0x00, 0x11, 0x08], sof);
  const v = new DataView(b.buffer);
  v.setUint16(sof + 5, height);
  v.setUint16(sof + 7, width);
  return b;
}

function ico(entries = 1): Uint8Array {
  const dataLen = 40;
  const b = new Uint8Array(6 + 16 * entries + dataLen * entries);
  const v = new DataView(b.buffer);
  v.setUint16(0, 0, true);
  v.setUint16(2, 1, true);
  v.setUint16(4, entries, true);
  for (let i = 0; i < entries; i++) {
    const e = 6 + 16 * i;
    b[e] = 32;
    b[e + 1] = 32;
    v.setUint32(e + 8, dataLen, true);
    v.setUint32(e + 12, 6 + 16 * entries + dataLen * i, true);
  }
  return b;
}

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

const SIMPLE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="#2563EB"/></svg>';

describe('favicon upload checks', () => {
  it('accepts PNG, ICO and a plain SVG by content', () => {
    expect(checkFavicon(pngHeader(512, 512))).toEqual({
      ok: true,
      ext: 'png',
      contentType: 'image/png',
    });
    expect(checkFavicon(ico())).toEqual({ ok: true, ext: 'ico', contentType: 'image/x-icon' });
    expect(checkFavicon(ico(3)).ok).toBe(true);
    expect(checkFavicon(enc(SIMPLE_SVG))).toEqual({
      ok: true,
      ext: 'svg',
      contentType: 'image/svg+xml',
    });
    expect(
      checkFavicon(
        enc(
          `${String.fromCharCode(0xfeff)}<?xml version="1.0" encoding="UTF-8"?>\n<!-- logo -->\n${SIMPLE_SVG}\n`,
        ),
      ).ok,
    ).toBe(true);
    expect(checkFavicon(enc(DEFAULT_ICON_SVG)).ok).toBe(true);
  });

  it('accepts a local url() reference written with a space', () => {
    expect(checkFavicon(enc('<svg><rect fill="url( \'#g\')"/></svg>')).ok).toBe(true);
  });

  it('accepts local references, styles and dark mode media queries', () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 32 32">
      <style>path { fill: #111 } @media (prefers-color-scheme: dark) { path { fill: #fff } }</style>
      <defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient>
      <path id="p" d="M0 0h32v32H0z"/></defs>
      <use xlink:href="#p"/><use href="#p" fill="url('#g')"/>
    </svg>`;
    expect(checkFavicon(enc(svg)).ok).toBe(true);
  });

  it('refuses anything else, whatever the file name says', () => {
    expect(checkFavicon(new Uint8Array()).ok).toBe(false);
    expect(checkFavicon(jpegHeader(64, 64)).ok).toBe(false);
    expect(checkFavicon(enc('GIF89a')).ok).toBe(false);
    expect(checkFavicon(enc('<html><body>hi</body></html>')).ok).toBe(false);
    expect(checkFavicon(enc('just text')).ok).toBe(false);
    // Broken ICO directory (entry points outside the file).
    const badIco = ico();
    new DataView(badIco.buffer).setUint32(6 + 12, 9999, true);
    expect(checkFavicon(badIco).ok).toBe(false);
  });

  it('enforces the size and pixel limits', () => {
    const big = new Uint8Array(FAVICON_MAX_BYTES + 1);
    big.set(pngHeader(64, 64));
    expect(checkFavicon(big)).toMatchObject({ ok: false, error: 'Le favicon dépasse 256 Ko.' });
    expect(checkFavicon(pngHeader(4096, 64)).ok).toBe(false);
    expect(checkFavicon(pngHeader(2048, 2048)).ok).toBe(true);
  });

  it.each([
    ['script element', '<svg><script>alert(1)</script></svg>'],
    [
      'namespaced script',
      '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:script>alert(1)</svg:script></svg:svg>',
    ],
    ['event handler', '<svg onload="alert(1)"><rect/></svg>'],
    ['event handler, other case', '<svg><rect ONCLICK=alert(1) /></svg>'],
    ['foreignObject', '<svg><foreignObject><div>x</div></foreignObject></svg>'],
    ['external image', '<svg><image href="https://evil.test/x.png"/></svg>'],
    ['javascript link', '<svg><a href="javascript:alert(1)"><rect/></a></svg>'],
    ['external use', '<svg><use href="https://evil.test/s.svg#x"/></svg>'],
    ['data use', '<svg><use xlink:href="data:image/svg+xml;base64,PHN2Zz4="/></svg>'],
    ['animation rewriting href', '<svg><set attributeName="href" to="javascript:alert(1)"/></svg>'],
    ['css external url', '<svg><rect style="fill:url(https://evil.test/a)"/></svg>'],
    ['css import', '<svg><style>@import "https://evil.test/a.css";</style></svg>'],
    ['css escape', '<svg><style>rect{fill:u\\72l(https://evil.test)}</style></svg>'],
    ['entity encoded url', '<svg><rect style="fill:url(&#x68;ttps://evil.test/a)"/></svg>'],
    ['doctype entities', '<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>'],
    [
      'processing instruction',
      '<?xml version="1.0"?><?xml-stylesheet href="https://evil.test/a.css"?><svg></svg>',
    ],
    ['iframe', '<svg><iframe src="https://evil.test"></iframe></svg>'],
    ['not closed', '<svg><rect/>'],
    [
      'handler hidden by a quote in text',
      '<svg xmlns="http://www.w3.org/2000/svg"><text>a="</text><rect onclick="alert(1)" width="9"/><text>"</text></svg>',
    ],
    [
      'handler hidden by a quote in a comment',
      '<svg xmlns="http://www.w3.org/2000/svg"><!-- a=" --><rect onmouseover="alert(1)"/><!-- " --></svg>',
    ],
    [
      'external href hidden by a quote in text',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:x="http://www.w3.org/1999/xlink"><text>a="</text><use x:href="https://evil.test/s.svg#a"/><text>"</text></svg>',
    ],
    ['handler after a ">" in a value', '<svg><rect a=">" onclick="alert(1)"/></svg>'],
    ['unquoted attribute', '<svg><rect onclick=alert(1) /></svg>'],
    ['numeric entity in url', '<svg><rect style="fill:u&#114;l(https://evil.test/x)"/></svg>'],
    [
      'numeric entity in import',
      '<svg><style>&#64;import "https://evil.test/a.css";</style></svg>',
    ],
    ['CDATA', '<svg><style><![CDATA[rect{fill:red}]]></style></svg>'],
    ['stray markup', '<svg><rect/><</svg>'],
    [
      'image-set() in a style sheet',
      '<svg><style>*{background:image-set("https://e.test/x.png" 1x)}</style></svg>',
    ],
    [
      '-webkit-image-set() in a style attribute',
      `<svg><rect style="background:-webkit-image-set('https://e.test/x.png' 1x)"/></svg>`,
    ],
    [
      'src() in a style sheet',
      '<svg><style>*{background:src("https://e.test/x.png")}</style></svg>',
    ],
  ])('refuses an SVG with %s', (_label, svg) => {
    expect(checkFavicon(enc(svg)).ok).toBe(false);
  });

  it('refuses charset tricks (ISO-2022-JP escapes hiding an event handler)', () => {
    const ESC = '\x1b';
    const payload =
      '<?xml version="1.0" encoding="ISO-2022-JP"?><svg xmlns="http://www.w3.org/2000/svg">' +
      `<rect b${ESC}$B='${ESC}(B="1" onclick="alert(1)" width="99" height="99" c=' d${ESC}$B='${ESC}(B'/></svg>`;
    expect(checkFavicon(enc(payload)).ok).toBe(false);
    // Each half on its own is refused too.
    expect(checkFavicon(enc(`<svg><rect a='${ESC}$B'/></svg>`)).ok).toBe(false);
    expect(
      checkFavicon(enc('<?xml version="1.0" encoding="ISO-2022-JP"?><svg><rect/></svg>')).ok,
    ).toBe(false);
    expect(checkFavicon(enc('<?xml version="1.0" encoding="UTF-8"?><svg><rect/></svg>')).ok).toBe(
      true,
    );
  });

  it('refuses an SVG that is not UTF-8', () => {
    const bytes = new Uint8Array([...enc('<svg><text>'), 0xff, 0xfe, ...enc('</text></svg>')]);
    expect(checkFavicon(bytes)).toMatchObject({ ok: false });
  });

  it('maps stored keys to content types', () => {
    expect(faviconContentType('brand/favicon-abcdefgh.png')).toBe('image/png');
    expect(faviconContentType('brand/favicon-abcdefgh.svg')).toBe('image/svg+xml');
    expect(faviconContentType('brand/favicon-abcdefgh.ico')).toBe('image/x-icon');
    expect(faviconContentType('brand/favicon-abcdefgh.html')).toBeNull();
  });
});

describe('image size', () => {
  it('reads PNG and JPEG headers', () => {
    expect(imageSize(pngHeader(600, 200))).toEqual({ width: 600, height: 200 });
    expect(imageSize(jpegHeader(320, 100))).toEqual({ width: 320, height: 100 });
    expect(imageSize(enc('nope'))).toBeNull();
  });

  it('fits a wide image in a square without distortion', () => {
    expect(containBox(600, 200, 256)).toEqual({ width: 256, height: 85 });
    expect(containBox(100, 400, 180)).toEqual({ width: 45, height: 180 });
    expect(containBox(64, 64, 256)).toEqual({ width: 256, height: 256 });
  });
});

describe('favicon fallback order', () => {
  const FAV = 'brand/favicon-aaaaaaaa.svg';
  const FAV_PNG = 'brand/favicon-bbbbbbbb.png';
  const LOGO = 'brand/logo-cccccccc.jpg';

  it('favicon, then logo, then the default icon', () => {
    expect(faviconSources({ favicon_key: FAV, logo_key: LOGO }).map((s) => s.kind)).toEqual([
      'favicon',
      'logo',
      'default',
    ]);
    expect(faviconSources({ favicon_key: null, logo_key: LOGO }).map((s) => s.kind)).toEqual([
      'logo',
      'default',
    ]);
    expect(faviconSources({ favicon_key: null, logo_key: null })).toEqual([{ kind: 'default' }]);
  });

  it('ignores keys that do not match the expected patterns', () => {
    expect(faviconSources({ favicon_key: '../etc/passwd', logo_key: 'brand/logo-x.svg' })).toEqual([
      { kind: 'default' },
    ]);
  });

  it('touch icon: raster sources only, default only without any agency icon', () => {
    expect(appleIconSources({ favicon_key: FAV_PNG, logo_key: LOGO }).map((s) => s.kind)).toEqual([
      'favicon',
      'logo',
    ]);
    expect(appleIconSources({ favicon_key: FAV, logo_key: LOGO }).map((s) => s.kind)).toEqual([
      'logo',
    ]);
    expect(appleIconSources({ favicon_key: FAV, logo_key: null })).toEqual([]);
    expect(appleIconSources({ favicon_key: null, logo_key: null })).toEqual([{ kind: 'default' }]);
  });

  it('versions the URLs with the key of the source in use', () => {
    expect(iconVersion(faviconSources({ favicon_key: FAV, logo_key: LOGO }))).toBe('faaaaaaaa');
    expect(iconVersion(faviconSources({ favicon_key: null, logo_key: LOGO }))).toBe('lcccccccc');
    expect(iconVersion(faviconSources({ favicon_key: null, logo_key: null }))).toBe('default');

    expect(iconLinks({ favicon_key: FAV, logo_key: LOGO })).toEqual({
      faviconUrl: '/media/brand/favicon?v=faaaaaaaa',
      faviconType: 'image/svg+xml',
      appleIconUrl: '/media/brand/apple-icon?v=lcccccccc',
    });
    expect(iconLinks({ favicon_key: FAV, logo_key: null }).appleIconUrl).toBeNull();
    expect(iconLinks({ favicon_key: null, logo_key: LOGO })).toMatchObject({
      faviconUrl: '/media/brand/favicon?v=lcccccccc',
      faviconType: 'image/png',
    });
    expect(iconLinks({ favicon_key: null, logo_key: null })).toEqual({
      faviconUrl: '/media/brand/favicon?v=default',
      faviconType: 'image/svg+xml',
      appleIconUrl: '/media/brand/apple-icon?v=default',
    });
  });
});
