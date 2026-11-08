/** Pure helpers of the favicon capture (no I/O, unit-tested). */

export type IconExt = 'png' | 'ico' | 'jpg' | 'gif' | 'webp';

export function sniffIcon(bytes: Uint8Array): IconExt | null {
  const b = bytes;
  if (b.length < 8) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00) return 'ico';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif';
  if (
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  ) {
    return 'webp';
  }
  return null;
}

/** Icon candidates declared in the home HTML, best first. */
export function iconCandidates(html: string, base: string): string[] {
  const out: { url: string; rank: number }[] = [];
  const re = /<link\b[^>]*>/gi;
  for (const m of html.matchAll(re)) {
    const tag = m[0];
    const rel = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag)?.[1]?.toLowerCase() ?? '';
    if (!/\bicon\b|apple-touch-icon/.test(rel)) continue;
    const href = /\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag)?.[1];
    if (!href || href.startsWith('data:')) continue;
    if (/\.svg(\?|$)/i.test(href) || /image\/svg/i.test(tag)) continue;
    let url: string;
    try {
      url = new URL(href, base).toString();
    } catch {
      continue;
    }
    if (!/^https?:/.test(url)) continue;
    const size = Number(/sizes\s*=\s*["']?(\d+)/i.exec(tag)?.[1] ?? 0);
    const rank = (rel.includes('apple-touch') ? 2 : 0) + (size >= 32 && size <= 192 ? 3 : 0);
    out.push({ url, rank });
  }
  out.sort((a, b) => b.rank - a.rank);
  const urls = out.map((o) => o.url);
  try {
    urls.push(new URL('/favicon.ico', base).toString());
  } catch {
    // ignore
  }
  return [...new Set(urls)].slice(0, 4);
}
