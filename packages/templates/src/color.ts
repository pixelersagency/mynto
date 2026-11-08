/** WCAG helpers for the agency color (auto contrast fix). */

const HEX = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

export function isHexColor(v: string): boolean {
  return HEX.test(v);
}

function channels(hex: string): [number, number, number] {
  const m = HEX.exec(hex);
  if (!m) return [0, 0, 0];
  return [m[1], m[2], m[3]].map((h) => Number.parseInt(h ?? '0', 16)) as [number, number, number];
}

function toHex(rgb: [number, number, number]): string {
  return `#${rgb
    .map((c) =>
      Math.max(0, Math.min(255, Math.round(c)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * Darkens `hex` (mixing with black, keeping the hue) until it reaches
 * `target` contrast on `bg`. Returns the color unchanged when it already does.
 */
export function ensureContrast(
  hex: string,
  bg = '#ffffff',
  target = 4.5,
): { color: string; adjusted: boolean } {
  const base = isHexColor(hex) ? hex.toLowerCase() : '#2563eb';
  if (contrastRatio(base, bg) >= target) return { color: base, adjusted: false };
  const rgb = channels(base);
  for (let step = 1; step <= 100; step += 1) {
    const k = 1 - step / 100;
    const c = toHex([rgb[0] * k, rgb[1] * k, rgb[2] * k]);
    if (contrastRatio(c, bg) >= target) return { color: c, adjusted: true };
  }
  return { color: '#000000', adjusted: true };
}

/**
 * Lightens `hex` (mixing with white) until it reaches `target` contrast on a
 * dark background. The default background (#27272a) is lighter than the dark
 * surfaces of the built-in templates, so the result reads on all of them.
 */
export function ensureContrastOnDark(
  hex: string,
  bg = '#27272a',
  target = 4.5,
): { color: string; adjusted: boolean } {
  const base = isHexColor(hex) ? hex.toLowerCase() : '#e9b48a';
  if (contrastRatio(base, bg) >= target) return { color: base, adjusted: false };
  const rgb = channels(base);
  for (let step = 1; step <= 100; step += 1) {
    const k = step / 100;
    const c = toHex([
      rgb[0] + (255 - rgb[0]) * k,
      rgb[1] + (255 - rgb[1]) * k,
      rgb[2] + (255 - rgb[2]) * k,
    ]);
    if (contrastRatio(c, bg) >= target) return { color: c, adjusted: true };
  }
  return { color: '#ffffff', adjusted: true };
}

/** White or near-black text, whichever reads better on `bg`. */
export function readableOn(bg: string): '#ffffff' | '#111827' {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111827') ? '#ffffff' : '#111827';
}
