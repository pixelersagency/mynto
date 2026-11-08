import { readFileSync } from 'node:fs';

/**
 * User-Agent of the audit bot (headless browser collectors, vision capture).
 *
 * Default: `Mozilla/5.0 (compatible; MyntoAudit/<version>; +<PUBLIC_URL>)`,
 * so a site owner who sees the bot in their logs can find out who ran it
 * (PUBLIC_URL is the agency's install). Override the whole string with
 * AUDIT_USER_AGENT.
 *
 * Read from process.env directly (not config.ts) so the CLI and the tests
 * can use the collectors without the server configuration.
 */

function packageVersion(): string {
  try {
    const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
    const v = (JSON.parse(raw) as { version?: unknown }).version;
    return typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v) ? v : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const MYNTO_VERSION = packageVersion();

/** Strips CR/LF and control characters: the value ends up in an HTTP header. */
function clean(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) out += ch;
  }
  return out.trim().slice(0, 300);
}

export function defaultAuditUserAgent(
  publicUrl: string | undefined,
  version = MYNTO_VERSION,
): string {
  const url = publicUrl && /^https?:\/\//.test(publicUrl) ? publicUrl.replace(/\/+$/, '') : null;
  return url
    ? `Mozilla/5.0 (compatible; MyntoAudit/${version}; +${url})`
    : `Mozilla/5.0 (compatible; MyntoAudit/${version})`;
}

export function auditUserAgent(env: NodeJS.ProcessEnv = process.env): string {
  const custom = env.AUDIT_USER_AGENT;
  if (custom !== undefined && clean(custom).length > 0) return clean(custom);
  return clean(defaultAuditUserAgent(env.PUBLIC_URL ?? env.WEB_BASE_URL));
}

/**
 * True when the operator set AUDIT_USER_AGENT explicitly. The plain HTTP
 * probes keep a real Chrome UA unless this is set (see collectors/http.ts).
 */
export function hasCustomAuditUserAgent(env: NodeJS.ProcessEnv = process.env): boolean {
  const custom = env.AUDIT_USER_AGENT;
  return custom !== undefined && clean(custom).length > 0;
}
