/**
 * Agency logo upload checks (pure, unit-tested). PNG and JPEG only, by
 * magic bytes (the browser-supplied MIME type is not trusted). SVG is
 * rejected on purpose: it can carry scripts and sanitising it is a risk we
 * do not need for a logo.
 */

export const LOGO_MAX_BYTES = 512 * 1024;

export type LogoCheck =
  | { ok: true; ext: 'png' | 'jpg'; contentType: 'image/png' | 'image/jpeg' }
  | { ok: false; error: string };

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export function checkLogo(bytes: Uint8Array): LogoCheck {
  if (bytes.length === 0) return { ok: false, error: 'Choisis un fichier.' };
  if (bytes.length > LOGO_MAX_BYTES) return { ok: false, error: 'Le logo dépasse 512 Ko.' };
  if (PNG.every((b, i) => bytes[i] === b)) {
    return { ok: true, ext: 'png', contentType: 'image/png' };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ok: true, ext: 'jpg', contentType: 'image/jpeg' };
  }
  return { ok: false, error: 'Format accepté : PNG ou JPEG (le SVG est refusé).' };
}

export function logoContentType(key: string): 'image/png' | 'image/jpeg' | null {
  if (key.endsWith('.png')) return 'image/png';
  if (key.endsWith('.jpg')) return 'image/jpeg';
  return null;
}
