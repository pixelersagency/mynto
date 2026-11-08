import { createHash } from 'node:crypto';

import pino from 'pino';

import { getServerEnv } from './env';

export const logger = pino({
  level: getServerEnv().LOG_LEVEL,
  base: { app: 'mynto-web' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'email',
      '*.email',
      '*.*.email',
      'password',
      '*.password',
      'token',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
});

export function hashEmail(email: string): string {
  return createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 16);
}
