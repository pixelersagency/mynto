/**
 * Validates a post-login `next` destination. Returns the path if it is a
 * safe same-site absolute path, otherwise null.
 *
 * Rejects open-redirect vectors:
 *  - absolute URLs / schemes ("https://evil.com", "javascript:...")
 *  - protocol-relative ("//evil.com")
 *  - backslash tricks ("/\evil.com", "/\/evil.com") - browsers normalize
 *    "\" to "/", so these resolve as protocol-relative
 *  - control chars (CR/LF header-injection, etc.) and over-long values
 */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

export function sanitizeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  if (raw.length > 512) return null;
  if (!raw.startsWith('/')) return null;
  if (raw.startsWith('//')) return null;
  if (raw.includes('\\')) return null;
  if (hasControlChars(raw)) return null;
  return raw;
}
