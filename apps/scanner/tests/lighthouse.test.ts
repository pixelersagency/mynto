import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  lighthouse: vi.fn(),
  kill: vi.fn(),
  warn: vi.fn(),
}));
vi.mock('chrome-launcher', () => ({ launch: mocks.launch }));
vi.mock('lighthouse', () => ({ default: mocks.lighthouse }));
vi.mock('playwright', () => ({ chromium: { executablePath: () => '/playwright/chromium' } }));
vi.mock('../src/logger.js', () => ({ logger: { warn: mocks.warn } }));
import { runLighthouse } from '../src/audit/collectors/lighthouse.js';

const report = (score: number | null = 0.8) => ({
  lhr: {
    categories: { performance: { score } },
    audits: {},
  },
});

describe('Lighthouse failures and whole-run deadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mocks.launch.mockResolvedValue({ port: 9222, kill: mocks.kill });
    mocks.lighthouse.mockResolvedValue(report());
  });
  afterEach(() => vi.useRealTimers());

  it('uses the Playwright binary and reaps Chrome on success', async () => {
    expect(await runLighthouse('https://example.com')).toMatchObject({
      fetched: true,
      performance: 0.8,
    });
    expect(mocks.launch).toHaveBeenCalledWith(
      expect.objectContaining({ chromePath: '/playwright/chromium' }),
    );
    expect(mocks.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a returned runtimeError is a failure even if category scores exist', async () => {
    mocks.lighthouse.mockResolvedValue({
      lhr: {
        ...report().lhr,
        runtimeError: {
          code: 'CHROME_INTERSTITIAL_ERROR',
          message: 'https://secret.invalid/?token=private',
        },
      },
    });
    const result = await runLighthouse('https://example.com');
    expect(result).toMatchObject({
      fetched: false,
      performance: null,
      errorCode: 'lighthouse_runtime_CHROME_INTERSTITIAL_ERROR',
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(mocks.kill).toHaveBeenCalledOnce();
  });

  it.each([null, NaN, Infinity, -1, 2])(
    'missing/invalid performance %s is unknown',
    async (score) => {
      mocks.lighthouse.mockResolvedValue(report(score));
      expect(await runLighthouse('https://example.com')).toMatchObject({
        performance: null,
        errorCode: 'lighthouse_performance_unavailable',
      });
    },
  );

  it('bounds a hung Lighthouse run, not only navigation', async () => {
    mocks.lighthouse.mockImplementation(() => new Promise(() => undefined));
    const pending = runLighthouse('https://example.com');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({ fetched: false, errorCode: 'lighthouse_timeout' });
    expect(mocks.kill).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reaps a browser whose launch resolves after the deadline', async () => {
    let finish: ((value: { port: number; kill: typeof mocks.kill }) => void) | undefined;
    mocks.launch.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = runLighthouse('https://example.com');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await pending).toMatchObject({ errorCode: 'lighthouse_timeout' });
    finish?.({ port: 9222, kill: mocks.kill });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.kill).toHaveBeenCalledOnce();
    expect(mocks.lighthouse).not.toHaveBeenCalled();
  });

  it('bounds cleanup when Chrome kill never settles', async () => {
    mocks.kill.mockImplementation(() => new Promise(() => undefined));
    const pending = runLighthouse('https://example.com');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toMatchObject({ fetched: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('records a fixed code for thrown failures without logging raw secrets', async () => {
    mocks.lighthouse.mockRejectedValue(new Error('token=private'));
    expect(await runLighthouse('https://example.com')).toMatchObject({
      fetched: false,
      errorCode: 'lighthouse_exception',
    });
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain('private');
  });
});
