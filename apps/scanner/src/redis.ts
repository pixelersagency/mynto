import { Redis } from 'ioredis';

import { config } from './config.js';

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
  lazyConnect: false,
});

redis.on('error', (err: Error) => {
  process.stderr.write(`[redis] ${err.message}\n`);
});
