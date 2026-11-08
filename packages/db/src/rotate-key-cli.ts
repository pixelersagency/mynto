import { closeSql, getSql } from './client.js';
import { RotationError, rotateEncryptionKey } from './rotate-key.js';

/**
 * `pnpm keys:rotate`: re-encrypts every secret stored in the database with
 * a new APP_ENCRYPTION_KEY.
 *
 *   APP_ENCRYPTION_KEY      the key in use today (old key)
 *   APP_ENCRYPTION_KEY_NEW  the new key (openssl rand -base64 32)
 *   DATABASE_URL            the database
 *
 * Stop the web app and the scanner first, run this, put the new key in
 * APP_ENCRYPTION_KEY (and remove APP_ENCRYPTION_KEY_NEW), then restart.
 * See README, section « Rotation de APP_ENCRYPTION_KEY ».
 */
async function main(): Promise<void> {
  const oldKey = process.env.APP_ENCRYPTION_KEY;
  const newKey = process.env.APP_ENCRYPTION_KEY_NEW;
  if (!process.env.DATABASE_URL) throw new RotationError('DATABASE_URL manquante.');
  if (!oldKey) throw new RotationError('APP_ENCRYPTION_KEY (clé actuelle) manquante.');
  if (!newKey) {
    throw new RotationError(
      'APP_ENCRYPTION_KEY_NEW manquante. Génère-la avec : openssl rand -base64 32',
    );
  }
  try {
    const r = await rotateEncryptionKey(getSql(), oldKey, newKey);
    const line = (label: string, c: { rotated: number; alreadyNew: number }): string =>
      `  ${label} : ${String(c.rotated)} rechiffré(s), ${String(c.alreadyNew)} déjà avec la nouvelle clé`;
    console.warn(
      [
        'Rotation terminée.',
        line('Clés IA', r.aiKeys),
        line('Mot de passe SMTP', r.smtp),
        line('Secrets de webhooks', r.webhooks),
        '',
        'Étape suivante : remplace APP_ENCRYPTION_KEY par la nouvelle valeur dans .env,',
        'retire APP_ENCRYPTION_KEY_NEW, puis redémarre le web et le scanner.',
      ].join('\n'),
    );
  } finally {
    await closeSql();
  }
}

main().catch((err: unknown) => {
  // RotationError and the key parsing errors carry a readable message; a
  // database error carries no secret either (values are bound parameters).
  console.error(`Rotation annulée : ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
