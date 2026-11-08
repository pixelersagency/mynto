import { createHash } from 'node:crypto';

import pino from 'pino';

import { config } from './config.js';

const isDev = config.NODE_ENV === 'development';

export const logger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      '*.email',
      '*.password',
      '*.token',
      '*.authorization',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-admin-token"]',
    ],
    censor: '[REDACTED]',
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
      }
    : {}),
});

export function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
}
