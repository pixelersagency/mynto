import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserServer,
  type Page,
  type Route,
} from 'playwright';

import { safeFetch } from './safe-fetch.js';

const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
const MAX_CONTEXT_BYTES = 32 * 1024 * 1024;
const MAX_CONTEXT_REQUESTS = 256;
interface RelayBudget {
  requests: number;
  bytes: number;
}
export const BROWSER_DEADLINE_MS = 60_000;
const CLEANUP_MS = 1000;

/** Chromium never follows an HTTP redirect itself. Reuse the pinned safe
 * transport, but reject redirects rather than fulfilling a final body under
 * the wrong document URL (which changes relative-resource semantics).
 * No cross-origin credential forwarding and no private redirect request.
 */
export async function relayBrowserRoute(
  route: Route,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  budget: RelayBudget = { requests: 0, bytes: 0 },
): Promise<boolean> {
  try {
    signal.throwIfAborted();
    const request = route.request();
    if (request.method() !== 'GET' && request.method() !== 'HEAD')
      throw new Error('static_method_unavailable');
    budget.requests += 1;
    if (budget.requests > MAX_CONTEXT_REQUESTS || budget.bytes >= MAX_CONTEXT_BYTES)
      throw new Error('browser_context_budget');
    const requestHeaders = { ...request.headers() };
    // Public anonymous observations do not need browser sessions. Never
    // relay credentials or cookies, including to a different origin.
    delete requestHeaders.cookie;
    delete requestHeaders.authorization;
    delete requestHeaders['proxy-authorization'];
    delete requestHeaders.host;
    delete requestHeaders['content-length'];
    const outcome = await safeFetch(
      request.url(),
      {
        method: request.method(),
        headers: requestHeaders,

        signal,
      },
      async (input, init) => {
        signal.throwIfAborted();
        const response = await fetchImpl(input, init);
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new Error('browser_redirect_unavailable');
        }
        return response;
      },
    );
    signal.throwIfAborted();
    if (!outcome.ok) throw new Error('browser_resource_unavailable');
    const response = outcome.response;
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    if (reader) {
      try {
        for (;;) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          budget.bytes += value.byteLength;
          if (bytes > MAX_RESOURCE_BYTES || budget.bytes > MAX_CONTEXT_BYTES)
            throw new Error('browser_resource_too_large');
          chunks.push(value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    }
    signal.throwIfAborted();
    // Node fetch decodes compression. Do not forward its stale wire lengths.
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    delete headers['set-cookie'];
    delete headers['content-encoding'];
    delete headers['content-length'];
    delete headers['transfer-encoding'];
    await route.fulfill({ status: response.status, headers, body: Buffer.concat(chunks) });
    return true;
  } catch {
    await route.abort('blockedbyclient').catch(() => undefined);
    return false;
  }
}

export async function guardBrowserContext(
  context: BrowserContext,
  signal: AbortSignal,
): Promise<{ isUnavailable: () => boolean }> {
  let unavailable = false;
  const budget: RelayBudget = { requests: 0, bytes: 0 };
  await context.route('**/*', async (route) => {
    if (
      !(await relayBrowserRoute(route, signal, fetch, budget)) &&
      ['document', 'stylesheet', 'image', 'font', 'script'].includes(route.request().resourceType())
    )
      unavailable = true;
  });
  // WebSockets are not covered by HTTP routing and are unnecessary for
  // these static observations. Never allow an unchecked socket escape.
  await context.routeWebSocket('**/*', (socket) => {
    void socket.close().catch(() => undefined);
  });
  return { isUnavailable: () => unavailable };
}

/** Own the exact Chromium process so a wedged renderer or graceful close
 * cannot extend the caller's deadline. The budget reserves cleanup time.
 * A late launch is killed too; no Promise.race branch can revive the job.
 */
export async function withAuditBrowser<T>(
  work: (browser: Browser, signal: AbortSignal) => Promise<T>,
  fallback: () => T,
  timeoutMs = BROWSER_DEADLINE_MS,
  cleanupMs = CLEANUP_MS,
): Promise<T> {
  const controller = new AbortController();
  let server: BrowserServer | undefined;
  const kill = (): void => {
    try {
      if (server) void server.kill().catch(() => undefined);
    } catch {
      /* Already exited. */
    }
  };
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(
      () => {
        controller.abort();
        kill();
        reject(new Error('browser_deadline'));
      },
      Math.max(1, timeoutMs - cleanupMs),
    );
  });
  const operation = (async (): Promise<T> => {
    server = await chromium.launchServer({
      headless: true,
      timeout: Math.max(1, timeoutMs - cleanupMs),
    });
    if (controller.signal.aborted) {
      kill();
      throw new Error('late_browser_launch');
    }
    const browser = await chromium.connect(server.wsEndpoint(), {
      timeout: Math.max(1, timeoutMs - cleanupMs),
    });
    controller.signal.throwIfAborted();
    return work(browser, controller.signal);
  })();
  try {
    return await Promise.race([operation, expired]);
  } catch {
    return fallback();
  } finally {
    clearTimeout(deadlineTimer);
    controller.abort();
    if (server) {
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          server.close().catch(() => {
            kill();
          }),
          new Promise<void>((resolve) => {
            cleanupTimer = setTimeout(() => {
              kill();
              resolve();
            }, cleanupMs);
          }),
        ]);
      } finally {
        clearTimeout(cleanupTimer);
      }
    }
  }
}

/** page.evaluate has no built-in timeout. Stop this page on expiry, while
 * the process-level deadline above remains the final backstop. */
export async function withPageDeadline<T>(
  page: Page,
  operation: () => Promise<T>,
  timeoutMs = 5000,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          void page.close({ runBeforeUnload: false }).catch(() => undefined);
          reject(new Error('page_evaluation_deadline'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
