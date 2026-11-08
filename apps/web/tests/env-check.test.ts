// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { checkServerEnv } from '@/lib/env';

const COMPLETE = {
  DATABASE_URL: 'postgres://mynto:pw@postgres:5432/mynto',
  ADMIN_EMAIL: 'admin@agence.fr',
  ADMIN_PASSWORD_HASH: 'scrypt:32768:8:1:salt:key',
  SESSION_SECRET: 'x'.repeat(64),
  SCANNER_INTERNAL_TOKEN: 'y'.repeat(64),
  APP_ENCRYPTION_KEY: 'z'.repeat(44),
  PUBLIC_URL: 'https://audit.agence.fr',
};

describe('checkServerEnv', () => {
  it('accepts a complete production configuration', () => {
    expect(checkServerEnv(COMPLETE, true)).toEqual({ errors: [], warnings: [] });
  });

  it('lists missing variables as errors in production, warnings in dev', () => {
    const env = { ...COMPLETE, SESSION_SECRET: undefined, ADMIN_PASSWORD_HASH: undefined };
    expect(checkServerEnv(env, true).errors).toEqual([
      '  - SESSION_SECRET : manquante (obligatoire)',
      '  - ADMIN_PASSWORD_HASH : manquante (obligatoire)',
    ]);
    const dev = checkServerEnv(env, false);
    expect(dev.errors).toEqual([]);
    expect(dev.warnings).toContain('  - SESSION_SECRET : manquante (obligatoire)');
  });

  it('reports invalid values without printing them', () => {
    const r = checkServerEnv({ ...COMPLETE, SESSION_SECRET: 'tooshort-secret' }, false);
    expect(r.errors).toEqual(['  - SESSION_SECRET : invalide (32 caractères minimum)']);
    expect(r.errors.join()).not.toContain('tooshort-secret');
  });

  it('warns when the public URL and the encryption key are missing', () => {
    const r = checkServerEnv(
      { ...COMPLETE, PUBLIC_URL: undefined, APP_ENCRYPTION_KEY: undefined },
      true,
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(2);
  });
});
