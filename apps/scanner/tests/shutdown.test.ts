import { spawn } from 'node:child_process';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { createShutdownHandler, type ShutdownStep } from '../src/lib/shutdown.js';

const silent = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

function harness(steps: ShutdownStep[], timeoutMs = 10_000) {
  const exit = vi.fn();
  let fire: (() => void) | null = null;
  const handler = createShutdownHandler({
    steps,
    timeoutMs,
    logger: silent,
    exit,
    setTimer: (fn) => {
      fire = fn;
      return { unref: () => undefined };
    },
    clearTimer: () => {
      fire = null;
    },
  });
  return { handler, exit, fireTimer: () => fire?.() };
}

describe('createShutdownHandler', () => {
  it('runs every step in order and exits 0', async () => {
    const order: string[] = [];
    const { handler, exit } = harness([
      { name: 'http', run: () => Promise.resolve(order.push('http')) },
      { name: 'workers', run: () => Promise.resolve(order.push('workers')) },
    ]);
    await handler('SIGTERM');
    expect(order).toEqual(['http', 'workers']);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('keeps going after a failing step and exits 1', async () => {
    const after = vi.fn(() => Promise.resolve());
    const { handler, exit } = harness([
      { name: 'postgres', run: () => Promise.reject(new Error('boom')) },
      { name: 'redis', run: after },
    ]);
    await handler('SIGTERM');
    expect(after).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('forces the exit when a step hangs past the deadline', async () => {
    const { handler, exit, fireTimer } = harness([
      { name: 'workers', run: () => new Promise(() => undefined) },
    ]);
    void handler('SIGTERM');
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();
    fireTimer();
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits at once on a second signal', async () => {
    const { handler, exit } = harness([
      { name: 'workers', run: () => new Promise(() => undefined) },
    ]);
    void handler('SIGINT');
    await handler('SIGINT');
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('scanner shutdown with Redis unreachable (child process)', () => {
  it('exits on SIGTERM within the deadline', async () => {
    // A "Redis" that accepts the TCP connection and never answers: the
    // worst case (host up, Redis wedged or a half-open connection).
    const sockets: Socket[] = [];
    const blackhole = createServer((s) => {
      sockets.push(s);
      s.on('error', () => undefined);
    });
    await new Promise<void>((r) => blackhole.listen(0, '127.0.0.1', r));
    const port = (blackhole.address() as AddressInfo).port;
    const fixture = fileURLToPath(new URL('./fixtures/shutdown-child.ts', import.meta.url));
    const child = spawn(process.execPath, ['--import', 'tsx', fixture], {
      env: {
        ...process.env,
        SHUTDOWN_TIMEOUT_MS: '1500',
        REDIS_URL: `redis://127.0.0.1:${String(port)}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (b: Buffer) => {
      out += b.toString();
    });
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => {
        reject(new Error(`child did not start: ${out}`));
      }, 20_000);
      child.stdout.on('data', () => {
        if (out.includes('ready')) {
          clearTimeout(t);
          resolve();
        }
      });
    });
    const started = Date.now();
    child.kill('SIGTERM');
    const code = await new Promise<number | null>((resolve) => {
      const guard = setTimeout(() => {
        child.kill('SIGKILL');
        resolve(null);
      }, 10_000);
      child.on('exit', (c) => {
        clearTimeout(guard);
        resolve(c);
      });
    });
    const elapsed = Date.now() - started;
    for (const s of sockets) s.destroy();
    blackhole.close();
    expect(code).toBe(1);
    expect(out).toContain('shutdown_timeout_forced_exit');
    expect(elapsed).toBeLessThan(10_000);
    expect(elapsed).toBeGreaterThanOrEqual(1_400);
  }, 40_000);
});
