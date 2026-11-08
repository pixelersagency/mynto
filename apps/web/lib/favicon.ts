/**
 * Agency favicon: upload checks and source resolution (pure, unit-tested,
 * no I/O). The effective icon of the instance is, in order:
 *
 *   1. the favicon uploaded in Réglages > Marque (PNG, SVG or ICO);
 *   2. the agency logo (PNG or JPEG, fitted on a square canvas);
 *   3. the default Mynto icon (DEFAULT_ICON_SVG).
 *
 * Types are checked by content (magic bytes, SVG structure), never by the
 * file name or the browser-supplied MIME type. An SVG is not sanitised but
 * refused as soon as it holds anything active or external: scripts, event
 * handlers, foreignObject, animations, external links or CSS url().
 */

export const FAVICON_MAX_BYTES = 256 * 1024;
/** Larger PNGs are refused: they are decoded server-side to build the touch icon. */
export const FAVICON_MAX_PX = 2048;
/** Above this a logo is served as is (never decoded server-side). */
export const RENDER_MAX_PX = 2048;

export type FaviconExt = 'png' | 'svg' | 'ico';
export type FaviconType = 'image/png' | 'image/svg+xml' | 'image/x-icon';

export type FaviconCheck =
  | { ok: true; ext: FaviconExt; contentType: FaviconType }
  | { ok: false; error: string };

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const FAVICON_TYPES: Record<FaviconExt, FaviconType> = {
  png: 'image/png',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
};

function isPng(b: Uint8Array): boolean {
  return b.length >= 24 && PNG_MAGIC.every((v, i) => b[i] === v);
}

function isJpeg(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

function be16(b: Uint8Array, i: number): number {
  return ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
}

function be32(b: Uint8Array, i: number): number {
  return (
    (((b[i] ?? 0) << 24) >>> 0) +
    (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0))
  );
}

function le16(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
}

function le32(b: Uint8Array, i: number): number {
  return le16(b, i) + le16(b, i + 2) * 0x10000;
}

/** Pixel size of a PNG or JPEG from its header, null when unreadable. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  if (isPng(b)) {
    // IHDR is always the first chunk: length(4) "IHDR"(4) width(4) height(4).
    if (String.fromCharCode(b[12] ?? 0, b[13] ?? 0, b[14] ?? 0, b[15] ?? 0) !== 'IHDR') return null;
    const width = be32(b, 16);
    const height = be32(b, 20);
    return width > 0 && height > 0 ? { width, height } : null;
  }
  if (isJpeg(b)) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const marker = b[i + 1] ?? 0;
      if (marker === 0xff) {
        i += 1;
        continue;
      }
      // Standalone markers carry no length.
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
        i += 2;
        continue;
      }
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        const height = be16(b, i + 5);
        const width = be16(b, i + 7);
        return width > 0 && height > 0 ? { width, height } : null;
      }
      const len = be16(b, i + 2);
      if (len < 2) return null;
      i += 2 + len;
    }
  }
  return null;
}

/** ICONDIR header, every directory entry inside the file. */
function isIco(b: Uint8Array): boolean {
  if (b.length < 22 || le16(b, 0) !== 0 || le16(b, 2) !== 1) return false;
  const count = le16(b, 4);
  if (count < 1 || count > 64 || b.length < 6 + 16 * count) return false;
  for (let n = 0; n < count; n++) {
    const entry = 6 + 16 * n;
    const size = le32(b, entry + 8);
    const offset = le32(b, entry + 12);
    if (size === 0 || offset < 6 + 16 * count || offset + size > b.length) return false;
  }
  return true;
}

/** Plain, static SVG elements. Anything else (script, foreignObject, image, a, animate, set...) is refused. */
const SVG_ELEMENTS = new Set([
  'svg',
  'g',
  'defs',
  'title',
  'desc',
  'symbol',
  'use',
  'style',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textpath',
  'lineargradient',
  'radialgradient',
  'stop',
  'pattern',
  'clippath',
  'mask',
  'filter',
  'feblend',
  'fecolormatrix',
  'fecomponenttransfer',
  'fecomposite',
  'feconvolvematrix',
  'fediffuselighting',
  'fedisplacementmap',
  'fedistantlight',
  'fedropshadow',
  'feflood',
  'fefunca',
  'fefuncb',
  'fefuncg',
  'fefuncr',
  'fegaussianblur',
  'femerge',
  'femergenode',
  'femorphology',
  'feoffset',
  'fepointlight',
  'fespecularlighting',
  'fespotlight',
  'fetile',
  'feturbulence',
]);

const BOM = new RegExp('^\\uFEFF');

const SVG_REFUSED =
  'SVG refusé : exporte un SVG simple, sans script ni lien externe, ou utilise un PNG.';

/**
 * Static-SVG check. Refuses rather than sanitises: the stored file is
 * exactly the uploaded one, so what was checked is what is served.
 */
export function checkSvgFavicon(bytes: Uint8Array): FaviconCheck {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, error: 'SVG illisible : il doit être encodé en UTF-8.' };
  }
  text = text.replace(BOM, '');
  const refused = { ok: false as const, error: SVG_REFUSED };
  if (text.includes('\0') || text.includes('\\')) return refused;
  // No DTD / entities (XXE, billion laughs), no processing instruction but the XML declaration.
  if (/<!doctype|<!entity/i.test(text)) return refused;
  // Control characters (only tab, LF and CR are allowed) would let a stateful
  // charset such as ISO-2022-JP hide quotes from this check.
  // eslint-disable-next-line no-control-regex -- matching control characters is the point
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(text)) return refused;
  // The check decodes UTF-8: an XML declaration may only confirm it.
  const decl = /^\s*<\?xml\s([^>]*)\?>/i.exec(text);
  if (
    decl &&
    /encoding\s*=/i.test(decl[1] ?? '') &&
    !/encoding\s*=\s*["']utf-8["']/i.test(decl[1] ?? '')
  ) {
    return refused;
  }
  let body = text.replace(/^\s*<\?xml\s[^>]*\?>/i, '');
  if (body.includes('<?')) return refused;
  // Comments go first (they may not hold "--" nor end open); no CDATA.
  if (/<!\[CDATA\[/i.test(body)) return refused;
  body = body.replace(/<!--(?:(?!--)[\s\S])*-->/g, ' ');
  if (body.includes('<!')) return refused;
  // Only the five predefined entities: no numeric reference can hide a
  // "url(", "@import" or "javascript:" from the checks below.
  if (/&(?!(?:amp|lt|gt|quot|apos);)/.test(body)) return refused;
  if (!/^\s*<svg[\s>]/i.test(body) || !/<\/svg\s*>\s*$/i.test(body)) {
    return { ok: false, error: 'Ce fichier n’est pas un SVG.' };
  }
  // Real tokenizer: every "<" must open a well-formed tag whose attributes
  // are all quoted, so a quote in text can never hide a real attribute.
  const tag =
    /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>"']+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
  for (let i = body.indexOf('<'); i !== -1; i = body.indexOf('<', i)) {
    tag.lastIndex = i;
    const m = tag.exec(body);
    if (m === null) return refused;
    i = tag.lastIndex;
    const name = (m[2] ?? '').toLowerCase().replace(/^svg:/, '');
    if (!SVG_ELEMENTS.has(name)) return refused;
    if (m[1] === '/' && (m[3] !== '' || m[4] === '/')) return refused;
    for (const a of (m[3] ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
      const attr = (a[1] ?? '').toLowerCase();
      const value = (a[2] ?? a[3] ?? '').trim();
      if (attr.startsWith('on')) return refused;
      if (attr === 'href' || attr.endsWith(':href')) {
        if (!/^#[\w.-]+$/.test(value)) return refused;
      }
      if (attr === 'src' || attr.endsWith(':base') || attr === 'xml:base') return refused;
    }
  }
  // CSS (style element or attribute): only local url(#id), no import, no expression.
  if (/url\s*\((?!\s*['"]?\s*#)/i.test(body)) return refused;
  // image-set() and src() take a URL as a plain string, without url().
  if (
    /@import|expression\s*\(|javascript:|vbscript:|image-set\s*\(|(?:^|[^-\w])src\s*\(/i.test(body)
  ) {
    return refused;
  }
  return { ok: true, ext: 'svg', contentType: 'image/svg+xml' };
}

export function checkFavicon(bytes: Uint8Array): FaviconCheck {
  if (bytes.length === 0) return { ok: false, error: 'Choisis un fichier.' };
  if (bytes.length > FAVICON_MAX_BYTES) {
    return { ok: false, error: 'Le favicon dépasse 256 Ko.' };
  }
  if (isPng(bytes)) {
    const size = imageSize(bytes);
    if (size === null) return { ok: false, error: 'PNG illisible.' };
    if (size.width > FAVICON_MAX_PX || size.height > FAVICON_MAX_PX) {
      return { ok: false, error: 'Image trop grande : 2048 x 2048 pixels maximum.' };
    }
    return { ok: true, ext: 'png', contentType: 'image/png' };
  }
  if (isIco(bytes)) return { ok: true, ext: 'ico', contentType: 'image/x-icon' };
  // Text formats last: an SVG starts with "<", optionally after a BOM or spaces.
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 512)).replace(BOM, '');
  if (/^\s*</.test(head)) return checkSvgFavicon(bytes);
  return { ok: false, error: 'Format accepté : PNG, SVG ou ICO.' };
}

export function faviconContentType(key: string): FaviconType | null {
  const ext = /\.(png|svg|ico)$/.exec(key)?.[1] as FaviconExt | undefined;
  return ext === undefined ? null : FAVICON_TYPES[ext];
}

// ---------------------------------------------------------------------------
// Source resolution
// ---------------------------------------------------------------------------

export type IconSource =
  | { kind: 'favicon'; key: string; contentType: FaviconType }
  | { kind: 'logo'; key: string; contentType: 'image/png' | 'image/jpeg' }
  | { kind: 'default' };

export interface IconKeys {
  favicon_key: string | null;
  logo_key: string | null;
}

const FAVICON_KEY = /^brand\/favicon-([a-z0-9]{8,32})\.(png|svg|ico)$/;
const LOGO_KEY = /^brand\/logo-([a-z0-9]{8,32})\.(png|jpg)$/;

/** Candidates in priority order; the last one is always the default icon. */
export function faviconSources(keys: IconKeys): IconSource[] {
  const out: IconSource[] = [];
  const f = keys.favicon_key !== null ? FAVICON_KEY.exec(keys.favicon_key) : null;
  if (f !== null && keys.favicon_key !== null) {
    out.push({
      kind: 'favicon',
      key: keys.favicon_key,
      contentType: FAVICON_TYPES[f[2] as FaviconExt],
    });
  }
  const l = keys.logo_key !== null ? LOGO_KEY.exec(keys.logo_key) : null;
  if (l !== null && keys.logo_key !== null) {
    out.push({
      kind: 'logo',
      key: keys.logo_key,
      contentType: l[2] === 'png' ? 'image/png' : 'image/jpeg',
    });
  }
  out.push({ kind: 'default' });
  return out;
}

/**
 * Touch icon candidates (raster only): a PNG favicon, then the logo. The
 * default icon only applies when the agency set neither a favicon nor a
 * logo, so an SVG or ICO favicon alone never shows the Mynto touch icon.
 */
export function appleIconSources(keys: IconKeys): IconSource[] {
  const all = faviconSources(keys);
  const raster = all.filter(
    (s) => s.kind === 'logo' || (s.kind === 'favicon' && s.contentType === 'image/png'),
  );
  const branded = all.some((s) => s.kind !== 'default');
  return branded ? raster : [{ kind: 'default' }];
}

/** Cache-busting version of a source list: the random id of the first key. */
export function iconVersion(sources: IconSource[]): string {
  const first = sources[0];
  if (first === undefined) return 'none';
  if (first.kind === 'default') return 'default';
  const id = (first.kind === 'favicon' ? FAVICON_KEY : LOGO_KEY).exec(first.key)?.[1] ?? '0';
  return `${first.kind === 'favicon' ? 'f' : 'l'}${id}`;
}

export const FAVICON_PATH = '/media/brand/favicon';
export const APPLE_ICON_PATH = '/media/brand/apple-icon';

export interface IconLinks {
  /** Effective favicon URL, always set (the default icon at worst). */
  faviconUrl: string;
  /** MIME type hint of the favicon link. */
  faviconType: string;
  /** Touch icon URL, null when no raster source fits. */
  appleIconUrl: string | null;
}

export function iconLinks(keys: IconKeys): IconLinks {
  const fav = faviconSources(keys);
  const apple = appleIconSources(keys);
  const first = fav[0];
  // Non-square logos and PNGs are re-encoded to PNG; SVG and ICO are served as is.
  const faviconType =
    first?.kind === 'favicon' && first.contentType !== 'image/png'
      ? first.contentType
      : first?.kind === 'default'
        ? 'image/svg+xml'
        : 'image/png';
  return {
    faviconUrl: `${FAVICON_PATH}?v=${iconVersion(fav)}`,
    faviconType,
    appleIconUrl: apple.length > 0 ? `${APPLE_ICON_PATH}?v=${iconVersion(apple)}` : null,
  };
}

/** Largest box of the given aspect ratio that fits in `size` x `size`. */
export function containBox(
  width: number,
  height: number,
  size: number,
): { width: number; height: number } {
  const scale = size / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** Default instance icon (Mynto bars), used when the agency set neither a favicon nor a logo. */
export const DEFAULT_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" fill="none">
  <rect width="64" height="64" rx="14" fill="#1a1d2e"/>
  <defs>
    <linearGradient id="bar" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#9aa0b0"/>
    </linearGradient>
  </defs>
  <rect x="15" y="34" width="10" height="18" rx="3" fill="url(#bar)"/>
  <rect x="27" y="26" width="10" height="26" rx="3" fill="url(#bar)"/>
  <rect x="39" y="16" width="10" height="36" rx="3" fill="url(#bar)"/>
</svg>
`;
