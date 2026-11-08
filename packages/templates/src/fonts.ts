/**
 * Report fonts. The curated families are bundled with the web app as woff2
 * files (apps/web/public/fonts, copied from @fontsource packages): reports
 * and PDFs never call a font CDN. A custom family uploaded by the agency
 * (woff2, regular + bold) is served from the media store.
 */

export interface FontFamily {
  id: string;
  name: string;
  /** CSS fallback stack after the family. */
  fallback: string;
  kind: 'sans' | 'serif';
}

export const FONT_CATALOG: readonly FontFamily[] = [
  { id: 'inter', name: 'Inter', fallback: 'ui-sans-serif, system-ui, sans-serif', kind: 'sans' },
  {
    id: 'plus-jakarta-sans',
    name: 'Plus Jakarta Sans',
    fallback: 'ui-sans-serif, system-ui, sans-serif',
    kind: 'sans',
  },
  {
    id: 'manrope',
    name: 'Manrope',
    fallback: 'ui-sans-serif, system-ui, sans-serif',
    kind: 'sans',
  },
  {
    id: 'dm-sans',
    name: 'DM Sans',
    fallback: 'ui-sans-serif, system-ui, sans-serif',
    kind: 'sans',
  },
  {
    id: 'ibm-plex-sans',
    name: 'IBM Plex Sans',
    fallback: 'ui-sans-serif, system-ui, sans-serif',
    kind: 'sans',
  },
  {
    id: 'source-serif-4',
    name: 'Source Serif 4',
    fallback: 'ui-serif, Georgia, serif',
    kind: 'serif',
  },
  { id: 'fraunces', name: 'Fraunces', fallback: 'ui-serif, Georgia, serif', kind: 'serif' },
  { id: 'merriweather', name: 'Merriweather', fallback: 'ui-serif, Georgia, serif', kind: 'serif' },
];

export const FONT_WEIGHTS = [400, 600, 700] as const;
export const DEFAULT_HEADING_FONT = 'inter';
export const DEFAULT_BODY_FONT = 'inter';
export const CUSTOM_FONT_ID = 'custom';
export const CUSTOM_FONT_MAX_BYTES = 500 * 1024;

export function isCatalogFont(id: string): boolean {
  return FONT_CATALOG.some((f) => f.id === id);
}

/** Custom family uploaded by the agency: URLs of its regular and bold files. */
export interface CustomFont {
  name: string;
  regularUrl: string | null;
  boldUrl: string | null;
}

export interface FontChoice {
  heading: string;
  body: string;
  custom: CustomFont | null;
}

const SAFE_NAME = /^[\p{L}\p{N} _-]{1,40}$/u;
const SAFE_URL = /^\/[A-Za-z0-9/._?=-]+$/;

function cssString(s: string): string {
  return `'${s.replace(/['\\]/g, '')}'`;
}

/**
 * @font-face rules for the chosen families and the CSS stacks. Unknown ids
 * fall back to the system stack; a missing custom file falls back too.
 */
export function fontCss(
  choice: FontChoice,
  fontsBase = '/fonts',
): { css: string; heading: string; body: string } {
  const faces: string[] = [];
  const stackFor = (id: string): string => {
    if (id === CUSTOM_FONT_ID && choice.custom && SAFE_NAME.test(choice.custom.name)) {
      return `${cssString(`${choice.custom.name} (agence)`)}, ui-sans-serif, system-ui, sans-serif`;
    }
    const f = FONT_CATALOG.find((x) => x.id === id);
    if (!f) return 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
    return `${cssString(f.name)}, ${f.fallback}`;
  };
  const used = new Set([choice.heading, choice.body]);
  for (const id of used) {
    if (id === CUSTOM_FONT_ID) {
      const c = choice.custom;
      if (!c || !SAFE_NAME.test(c.name)) continue;
      const family = cssString(`${c.name} (agence)`);
      if (c.regularUrl && SAFE_URL.test(c.regularUrl)) {
        faces.push(
          `@font-face{font-family:${family};src:url('${c.regularUrl}') format('woff2');font-weight:400 500;font-style:normal;font-display:swap}`,
        );
      }
      if (c.boldUrl && SAFE_URL.test(c.boldUrl)) {
        faces.push(
          `@font-face{font-family:${family};src:url('${c.boldUrl}') format('woff2');font-weight:600 800;font-style:normal;font-display:swap}`,
        );
      }
      continue;
    }
    const f = FONT_CATALOG.find((x) => x.id === id);
    if (!f) continue;
    for (const w of FONT_WEIGHTS) {
      faces.push(
        `@font-face{font-family:${cssString(f.name)};src:url('${fontsBase}/${f.id}-latin-${String(w)}-normal.woff2') format('woff2');font-weight:${String(w)};font-style:normal;font-display:swap}`,
      );
    }
  }
  return { css: faces.join('\n'), heading: stackFor(choice.heading), body: stackFor(choice.body) };
}

/** True when `bytes` starts with the woff2 signature ("wOF2"). */
export function isWoff2(bytes: Uint8Array): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x77 &&
    bytes[1] === 0x4f &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x32
  );
}
