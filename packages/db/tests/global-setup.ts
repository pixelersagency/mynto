import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { GlobalSetupContext } from 'vitest/node';

/**
 * Provides a throwaway PostgreSQL to the integration tests, in order:
 *   1. TEST_DATABASE_URL when set (CI service container, your own server);
 *   2. local binaries (initdb + pg_ctl on PATH): temp cluster on a random port;
 *   3. Docker: postgres:16-alpine on a random port.
 * When none is available the integration tests are skipped (not failed).
 */

const run = promisify(execFile);

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string | null;
    databaseSource: string;
  }
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => {
        if (addr !== null && typeof addr === 'object') resolve(addr.port);
        else reject(new Error('no port'));
      });
    });
  });
}

async function has(cmd: string, args: string[]): Promise<boolean> {
  try {
    await run(cmd, args);
    return true;
  } catch {
    return false;
  }
}

async function waitReady(check: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('postgres did not become ready');
}

async function startLocal(): Promise<{ url: string; stop: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mynto-pg-'));
  const data = path.join(dir, 'data');
  const port = await freePort();
  // macOS: the postmaster refuses to start with an invalid locale in the env.
  const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
  await run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--no-locale'], {
    env,
  });
  await run(
    'pg_ctl',
    [
      '-D',
      data,
      '-l',
      path.join(dir, 'log'),
      '-o',
      `-p ${String(port)} -c unix_socket_directories='' -c listen_addresses=127.0.0.1 -c fsync=off`,
      '-w',
      'start',
    ],
    { env },
  ).catch(async (err: unknown) => {
    await rm(dir, { recursive: true, force: true });
    throw err;
  });
  return {
    url: `postgres://postgres@127.0.0.1:${String(port)}/postgres`,
    stop: async () => {
      await run('pg_ctl', ['-D', data, '-m', 'immediate', 'stop']).catch(() => undefined);
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function startDocker(): Promise<{ url: string; stop: () => Promise<void> }> {
  const port = await freePort();
  const { stdout } = await run('docker', [
    'run',
    '-d',
    '--rm',
    '-e',
    'POSTGRES_PASSWORD=test',
    '-p',
    `127.0.0.1:${String(port)}:5432`,
    'postgres:16-alpine',
  ]);
  const id = stdout.trim();
  await waitReady(() => has('docker', ['exec', id, 'pg_isready', '-U', 'postgres']));
  return {
    url: `postgres://postgres:test@127.0.0.1:${String(port)}/postgres`,
    stop: async () => {
      await run('docker', ['rm', '-f', id]).catch(() => undefined);
    },
  };
}

export default async function setup({ provide }: GlobalSetupContext): Promise<() => Promise<void>> {
  const fromEnv = process.env.TEST_DATABASE_URL;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    provide('databaseUrl', fromEnv);
    provide('databaseSource', 'TEST_DATABASE_URL');
    return () => Promise.resolve();
  }

  let started: { url: string; stop: () => Promise<void> } | null = null;
  let source = 'none';
  if ((await has('initdb', ['--version'])) && (await has('pg_ctl', ['--version']))) {
    started = await startLocal();
    const { stdout } = await run('postgres', ['--version']);
    source = `local ${stdout.trim()}`;
  } else if (await has('docker', ['info'])) {
    started = await startDocker();
    source = 'docker postgres:16-alpine';
  }

  provide('databaseUrl', started?.url ?? null);
  provide('databaseSource', source);
  console.warn(`[db tests] database: ${source}`);
  return async () => {
    await started?.stop();
  };
}
