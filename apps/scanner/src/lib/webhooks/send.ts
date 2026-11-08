import { WEBHOOK_RESPONSE_MAX, WEBHOOK_TIMEOUT_MS } from '@mynto/shared';

import { pinnedAgent, readCappedText } from '../../audit/collectors/safe-fetch.js';

import { checkWebhookTarget, type LookupAll } from './target.js';

/**
 * One HTTP attempt of a webhook: SSRF check, pinned address, 10 s timeout,
 * redirects refused (a 3xx is a failure, never followed), answer capped at
 * 2 KB for the log. Never throws.
 */

export interface SendResult {
  ok: boolean;
  statusCode: number | null;
  /** timeout, network_error, redirect_refused, http_<code>, or the SSRF reason. */
  error: string | null;
  durationMs: number;
  responseBody: string | null;
}

export async function sendWebhookRequest(input: {
  url: string;
  headers: Record<string, string>;
  body: string;
  allowPrivate: boolean;
  timeoutMs?: number;
  lookup?: LookupAll;
  fetchImpl?: typeof fetch;
}): Promise<SendResult> {
  const started = performance.now();
  const elapsed = (): number => Math.round(performance.now() - started);

  const target = await checkWebhookTarget(input.url, {
    allowPrivate: input.allowPrivate,
    ...(input.lookup ? { lookup: input.lookup } : {}),
  });
  if (!target.ok) {
    return {
      ok: false,
      statusCode: null,
      error: `blocked_target:${target.reason}`,
      durationMs: elapsed(),
      responseBody: null,
    };
  }

  const agent = pinnedAgent(target.ip);
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, input.timeoutMs ?? WEBHOOK_TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await (input.fetchImpl ?? fetch)(input.url, {
        method: 'POST',
        headers: input.headers,
        body: input.body,
        redirect: 'manual',
        signal: controller.signal,
        dispatcher: agent,
      } as RequestInit);
    } catch {
      return {
        ok: false,
        statusCode: null,
        error: controller.signal.aborted ? 'timeout' : 'network_error',
        durationMs: elapsed(),
        responseBody: null,
      };
    }
    let text: string | null = null;
    try {
      text = (await readCappedText(res, WEBHOOK_RESPONSE_MAX)).slice(0, WEBHOOK_RESPONSE_MAX);
    } catch {
      text = null;
    }
    const status = res.status;
    const ok = status >= 200 && status < 300;
    return {
      ok,
      statusCode: status,
      error: ok
        ? null
        : status >= 300 && status < 400
          ? 'redirect_refused'
          : `http_${String(status)}`,
      durationMs: elapsed(),
      responseBody: text,
    };
  } finally {
    clearTimeout(timer);
    void agent.close().catch(() => undefined);
  }
}
