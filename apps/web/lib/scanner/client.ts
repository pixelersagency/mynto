import { getServerEnv } from '../env';

export interface ScannerResponse {
  status: number;
  body: unknown;
}

export interface ForwardOptions {
  clientIp: string | null;
  forwardedFor: string | null;
  timeoutMs?: number;
  /**
   * Raw `Authorization` header to pass through untouched (Radar API key).
   * The scanner checks it; the web proxy never interprets it.
   */
  authorization?: string;
  /** Original browser User-Agent (Radar view beacon bot filtering). */
  userAgent?: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export async function postScannerRadar(
  path: string,
  payload: unknown,
  opts: ForwardOptions,
): Promise<ScannerResponse> {
  return callScannerEndpoint('POST', `/api/radar${path}`, payload, opts);
}

export async function getScannerRadar(
  path: string,
  opts: ForwardOptions,
): Promise<ScannerResponse> {
  return callScannerEndpoint('GET', `/api/radar${path}`, undefined, opts);
}

async function callScannerEndpoint(
  method: 'GET' | 'POST',
  path: string,
  payload: unknown,
  opts: ForwardOptions,
): Promise<ScannerResponse> {
  const env = getServerEnv();
  const url = `${env.SCANNER_API_URL.replace(/\/$/, '')}${path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  const fwd = buildForwardedFor(opts.forwardedFor, opts.clientIp);
  const headers: Record<string, string> = {};
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json';
  }
  if (fwd !== null) {
    headers['X-Forwarded-For'] = fwd;
  }
  if (typeof opts.authorization === 'string' && opts.authorization.length > 0) {
    headers.Authorization = opts.authorization;
  }
  if (typeof opts.userAgent === 'string' && opts.userAgent.length > 0) {
    headers['User-Agent'] = opts.userAgent;
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      ...(method === 'POST' ? { body: JSON.stringify(payload) } : {}),
      signal: controller.signal,
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as unknown;
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function buildForwardedFor(existing: string | null, clientIp: string | null): string | null {
  const parts: string[] = [];
  if (existing !== null && existing.length > 0) parts.push(existing);
  if (clientIp !== null && clientIp.length > 0 && !parts.includes(clientIp)) parts.push(clientIp);
  if (parts.length === 0) return null;
  return parts.join(', ');
}

/** SCANNER_INTERNAL_TOKEN is missing on the web side. */
export class ScannerNotConfiguredError extends Error {
  constructor() {
    super('SCANNER_INTERNAL_TOKEN is not set');
    this.name = 'ScannerNotConfiguredError';
  }
}

/**
 * Authenticated write call to the scanner (audit create / refresh /
 * delete), server side only: the internal token never reaches a browser.
 */
export async function callScannerInternal(
  method: 'POST' | 'DELETE',
  path: string,
  payload?: unknown,
  timeoutMs = 20_000,
): Promise<ScannerResponse> {
  const env = getServerEnv();
  const token = env.SCANNER_INTERNAL_TOKEN;
  if (token === undefined) throw new ScannerNotConfiguredError();
  const url = `${env.SCANNER_API_URL.replace(/\/$/, '')}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'x-internal-token': token,
        ...(payload !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
      signal: controller.signal,
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as unknown;
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

/** True when the scanner answers its health check within 1.5 s. */
export async function scannerOnline(): Promise<boolean> {
  const env = getServerEnv();
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, 1_500);
  try {
    const res = await fetch(`${env.SCANNER_API_URL.replace(/\/$/, '')}/health`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
