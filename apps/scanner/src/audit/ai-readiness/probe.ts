import { readCappedText, safeFetch } from '../collectors/safe-fetch.js';
import { auditUserAgent } from '../user-agent.js';

import type { AiAuditLogger } from './types.js';

/**
 * User-Agent of the probes: the scanner's own (AUDIT_USER_AGENT, or the
 * default that names the install). Honest identification, no impersonation
 * of a real agent.
 */
export function aiProbeUserAgent(): string {
  return auditUserAgent();
}

/**
 * UA used to check how the site treats an AI crawler. It carries the bot
 * token so WAF rules keyed on it actually fire, but it never claims to *be*
 * that crawler: it is the scanner's UA with a "simulating" note.
 */
export function simulatedBotUserAgent(botName: string): string {
  return `${aiProbeUserAgent()} (simulating ${botName})`;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 512_000;
const BODY_PREVIEW_CHARS = 160;

export interface ProbeResult {
  url: string;
  /** HTTP status, or `'error'` when the request never completed. */
  status: number | 'error';
  ok: boolean;
  contentType: string;
  headers: Record<string, string>;
  body: string;
  /** Short, safe-to-display excerpt of the body. */
  preview: string;
  /**
   * Why the request failed, when `status` is `'error'`. Internal only:
   * it names our own failure modes (DNS, TLS, no route) and never goes
   * into the evidence published on the report.
   */
  errorReason?: string;
}

export interface ProbeOptions {
  accept?: string;
  userAgent?: string;
  timeoutMs?: number;
  method?: 'GET' | 'HEAD';
  maxBytes?: number;
  /** Logs the cause of a failed probe. Nothing is logged without it. */
  logger?: AiAuditLogger;
}

/**
 * SSRF-safe probe of one URL on the audited site.
 *
 * Never throws: a network error, a timeout or an unsafe redirect all come
 * back as `status: 'error'`, so a single dead endpoint cannot abort the
 * audit. Redirects are validated hop by hop by `safeFetch`.
 */
export async function probe(url: string, opts: ProbeOptions = {}): Promise<ProbeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    ctrl.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const result = await safeFetch(url, {
      method: opts.method ?? 'GET',
      signal: ctrl.signal,
      headers: {
        'User-Agent': opts.userAgent ?? aiProbeUserAgent(),
        Accept: opts.accept ?? '*/*',
      },
    });
    if (!result.ok) {
      opts.logger?.warn({ url, kind: result.kind, reason: result.reason }, 'ai_probe_failed');
      return errorProbe(url, `${result.kind}:${result.reason}`);
    }

    const { response, finalUrl } = result;
    const body =
      opts.method === 'HEAD' ? '' : await readCappedText(response, opts.maxBytes ?? MAX_BODY_BYTES);

    return {
      url: finalUrl,
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
      headers: headersToObject(response.headers),
      body,
      // The preview is republished on a public report, so it is kept only
      // for successful responses (an error page carries no useful proof)
      // and stripped of control and bidi characters before storage.
      preview: response.status >= 200 && response.status < 300 ? preview(body) : '',
    };
  } catch (err) {
    // Reached only when reading the body fails; safeFetch reports the
    // request itself.
    const reason = err instanceof Error ? `${err.name}:${err.message}` : String(err);
    opts.logger?.warn({ url, kind: 'body_read', reason }, 'ai_probe_failed');
    return errorProbe(url, `body_read:${reason.slice(0, 160)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Probe several URLs in order, stopping at the first 2xx. */
export async function probeFirstOk(
  urls: string[],
  opts: ProbeOptions = {},
): Promise<ProbeResult[]> {
  const tried: ProbeResult[] = [];
  for (const url of urls) {
    const res = await probe(url, opts);
    tried.push(res);
    if (res.ok) break;
  }
  return tried;
}

export function isJsonLike(res: ProbeResult): boolean {
  if (res.contentType.includes('json')) return true;
  const trimmed = res.body.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export function parseJsonBody(res: ProbeResult): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(res.body);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function errorProbe(url: string, errorReason: string): ProbeResult {
  return {
    url,
    status: 'error',
    ok: false,
    contentType: '',
    headers: {},
    body: '',
    preview: '',
    errorReason,
  };
}

function preview(body: string): string {
  const flat = body
    // Control characters and bidi overrides: a hostile site could otherwise
    // hide or reorder text inside our own report.
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > BODY_PREVIEW_CHARS ? `${flat.slice(0, BODY_PREVIEW_CHARS)}…` : flat;
}

/**
 * Only the headers a report needs. Keeps the persisted evidence small and
 * avoids echoing back cookies or auth-ish headers set by the audited site.
 */
const KEPT_HEADERS = [
  'content-type',
  'link',
  'server',
  'x-powered-by',
  'cf-ray',
  'www-authenticate',
  'accept-signature',
  'signature-agent',
  'x-payment',
  'x-accept-payment',
] as const;

function headersToObject(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of KEPT_HEADERS) {
    const value = headers.get(name);
    if (value !== null) out[name] = value.slice(0, 500);
  }
  return out;
}
