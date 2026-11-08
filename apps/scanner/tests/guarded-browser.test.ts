import { chromium, type Browser, type BrowserServer, type Page, type Route } from 'playwright';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  relayBrowserRoute,
  withAuditBrowser,
  withPageDeadline,
} from '../src/audit/collectors/guarded-browser.js';

function fakeRoute(method = 'GET'): {
  route: Route;
  fulfill: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
} {
  const fulfill = vi.fn().mockResolvedValue(undefined);
  const abort = vi.fn().mockResolvedValue(undefined);
  const route = {
    request: () => ({
      url: () => 'https://example.com/public',
      method: () => method,
      headers: () => ({
        cookie: 'session=private',
        authorization: 'Bearer private',
        accept: '*/*',
      }),
      resourceType: () => 'document',
    }),
    fulfill,
    abort,
  } as unknown as Route;
  return { route, fulfill, abort };
}

describe('pinned static browser relay', () => {
  it('blocks a public redirect to loopback before any private request or browser redirect', async () => {
    const request = fakeRoute();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } }),
      );
    expect(await relayBrowserRoute(request.route, new AbortController().signal, fetcher)).toBe(
      false,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://example.com/public');
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' });
    expect(fetcher.mock.calls[0]?.[1]).toHaveProperty('dispatcher');
    expect(request.fulfill).not.toHaveBeenCalled();
    expect(request.abort).toHaveBeenCalledWith('blockedbyclient');
  });

  it('rejects public redirects too, preserving URL/base semantics instead of relaying a wrong-base body', async () => {
    const request = fakeRoute();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('', { status: 301, headers: { location: 'https://other.example/new/' } }),
      );
    expect(await relayBrowserRoute(request.route, new AbortController().signal, fetcher)).toBe(
      false,
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('relays decoded binary bytes, stripping wire encoding, lengths, sessions and response cookies', async () => {
    const request = fakeRoute();
    const bytes = new Uint8Array([0, 255, 10, 42]);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(bytes, {
        headers: {
          'content-encoding': 'gzip',
          'content-length': '100',
          'transfer-encoding': 'chunked',
          'set-cookie': 's=private',
          'content-type': 'image/png',
        },
      }),
    );
    expect(await relayBrowserRoute(request.route, new AbortController().signal, fetcher)).toBe(
      true,
    );
    const init = fetcher.mock.calls[0]?.[1];
    expect(init?.headers).not.toHaveProperty('cookie');
    expect(init?.headers).not.toHaveProperty('authorization');
    expect(request.fulfill).toHaveBeenCalledWith({
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: Buffer.from(bytes),
    });
  });

  it('blocks unsupported methods before fetching', async () => {
    const fetcher = vi.fn<typeof fetch>();
    expect(
      await relayBrowserRoute(fakeRoute('POST').route, new AbortController().signal, fetcher),
    ).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('caps each binary body, context bytes and resource count', async () => {
    const signal = new AbortController().signal;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(new Uint8Array(8 * 1024 * 1024 + 1)));
    expect(await relayBrowserRoute(fakeRoute().route, signal, fetcher)).toBe(false);
    expect(
      await relayBrowserRoute(fakeRoute().route, signal, fetcher, { requests: 256, bytes: 0 }),
    ).toBe(false);
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array([1, 2])));
    expect(
      await relayBrowserRoute(fakeRoute().route, signal, fetcher, {
        requests: 0,
        bytes: 32 * 1024 * 1024 - 1,
      }),
    ).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('browser deadline covers every phase', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it.each(['launch', 'evaluation', 'body', 'cleanup'])(
    'bounds a hung %s and kills owned Chromium',
    async (phase) => {
      vi.useFakeTimers();
      const never = new Promise<never>(() => undefined);
      const kill = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
      const server = {
        kill,
        wsEndpoint: () => 'ws://test',
        close: () => never,
      } as unknown as BrowserServer;
      let finishLaunch: ((server: BrowserServer) => void) | undefined;
      vi.spyOn(chromium, 'launchServer').mockImplementation(() =>
        phase === 'launch'
          ? new Promise<BrowserServer>((resolve) => {
              finishLaunch = resolve;
            })
          : Promise.resolve(server),
      );
      vi.spyOn(chromium, 'connect').mockResolvedValue({} as Browser);
      const run = withAuditBrowser(
        async (_browser, signal) => {
          if (phase === 'evaluation')
            return withPageDeadline({ close: () => never } as unknown as Page, () => never);
          if (phase === 'body') {
            const route = fakeRoute();
            await relayBrowserRoute(route.route, signal, () =>
              Promise.resolve(
                new Response(new ReadableStream<Uint8Array>({ start: () => undefined })),
              ),
            );
            return 'finished';
          }
          return 'finished';
        },
        () => 'unavailable',
        100,
        10,
      );
      await vi.advanceTimersByTimeAsync(100);
      expect(await run).toBe(phase === 'cleanup' ? 'finished' : 'unavailable');
      if (phase === 'launch') {
        finishLaunch?.(server);
        await vi.advanceTimersByTimeAsync(0);
      }
      expect(kill).toHaveBeenCalled();
    },
  );

  it('bounds a standalone hung page evaluation even if page.close hangs', async () => {
    vi.useFakeTimers();
    const never = new Promise<never>(() => undefined);
    const close = vi.fn(() => never);
    const run = withPageDeadline({ close } as unknown as Page, () => never, 20);
    const rejected = expect(run).rejects.toThrow('page_evaluation_deadline');
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(close).toHaveBeenCalled();
  });
});
