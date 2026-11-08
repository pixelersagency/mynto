/**
 * Child process of shutdown.test.ts: the scanner's shutdown sequence with
 * a Redis that accepts connections and never answers (REDIS_URL points at
 * a black hole). BullMQ's worker.close() and ioredis' quit() then never
 * settle, which is exactly what used to hang `docker compose stop`.
 */
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { createShutdownHandler } from '../../src/lib/shutdown.js';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:1', {
  maxRetriesPerRequest: null,
});
redis.on('error', () => undefined);
const worker = new Worker('shutdown-test', () => Promise.resolve(), { connection: redis });
worker.on('error', () => undefined);

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
const shutdown = createShutdownHandler({
  timeoutMs: Number(process.env.SHUTDOWN_TIMEOUT_MS ?? '1500'),
  logger: {
    ...silent,
    error: (_obj: object, msg: string) => {
      process.stdout.write(`${msg}\n`);
    },
  },
  steps: [
    { name: 'workers', run: () => worker.close() },
    { name: 'redis', run: () => redis.quit() },
  ],
});
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.stdout.write('ready\n');
