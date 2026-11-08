import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { describeEnvIssues } from './env-messages.js';

describe('describeEnvIssues', () => {
  const Schema = z.object({
    DATABASE_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32),
    MODE: z.enum(['system', 'doh']),
    REDIS_URL: z.string().url().startsWith('redis'),
  });

  it('names each variable, in French, without its value', () => {
    const env = { SESSION_SECRET: 'short-secret-value', MODE: 'dns', REDIS_URL: 'http://x' };
    const r = Schema.safeParse(env);
    expect(r.success).toBe(false);
    const lines = describeEnvIssues(r.success ? [] : r.error.issues, env);
    expect(lines).toEqual([
      '  - DATABASE_URL : manquante (obligatoire)',
      '  - SESSION_SECRET : invalide (32 caractères minimum)',
      '  - MODE : invalide (valeurs possibles : system, doh)',
      '  - REDIS_URL : invalide (doit commencer par « redis »)',
    ]);
    expect(lines.join('\n')).not.toContain('short-secret-value');
  });
});
