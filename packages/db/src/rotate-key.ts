import type { Sql } from './client.js';
import { SMTP_PASSWORD_AAD } from './repos/email.js';
import { webhookSecretAad } from './repos/webhooks.js';
import { DecryptionError, decryptSecret, encryptSecret, parseMasterKey } from './secrets.js';

/**
 * Rotation of APP_ENCRYPTION_KEY: every secret encrypted at rest is
 * decrypted with the current key and encrypted again with the new one, in
 * one transaction (all or nothing):
 *   - AI provider keys (ai_provider_keys.ciphertext, AAD = provider);
 *   - SMTP password (smtp_settings.password_ciphertext, AAD "smtp");
 *   - webhook signing secrets (webhook_endpoints.secret_ciphertext,
 *     AAD "webhook:<id>").
 *
 * Resumable: a value that already opens with the new key is left alone, so
 * running the command twice is harmless. A value that opens with neither
 * key aborts the whole rotation (nothing is written). No plaintext and no
 * key is ever logged or returned.
 */

export interface RotationCounts {
  rotated: number;
  alreadyNew: number;
}

export interface RotationResult {
  aiKeys: RotationCounts;
  smtp: RotationCounts;
  webhooks: RotationCounts;
}

export class RotationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RotationError';
  }
}

function reencrypt(
  stored: string,
  aad: string,
  oldKey: string,
  newKey: string,
  label: string,
): { value: string; changed: boolean } {
  try {
    decryptSecret(stored, newKey, aad);
    return { value: stored, changed: false };
  } catch (err) {
    if (!(err instanceof DecryptionError)) throw err;
  }
  let plain: string;
  try {
    plain = decryptSecret(stored, oldKey, aad);
  } catch {
    throw new RotationError(
      `${label} : impossible à déchiffrer avec l'ancienne clé ni avec la nouvelle. Rien n'a été modifié.`,
    );
  }
  return { value: encryptSecret(plain, newKey, aad), changed: true };
}

export async function rotateEncryptionKey(
  sql: Sql,
  oldKey: string,
  newKey: string,
): Promise<RotationResult> {
  // Throws EncryptionKeyMissingError / EncryptionKeyInvalidError early.
  const oldBytes = parseMasterKey(oldKey);
  const newBytes = parseMasterKey(newKey);
  if (oldBytes.equals(newBytes)) {
    throw new RotationError("La nouvelle clé est identique à l'ancienne.");
  }

  return sql.begin(async (tx) => {
    const result: RotationResult = {
      aiKeys: { rotated: 0, alreadyNew: 0 },
      smtp: { rotated: 0, alreadyNew: 0 },
      webhooks: { rotated: 0, alreadyNew: 0 },
    };
    const count = (c: RotationCounts, changed: boolean): void => {
      if (changed) c.rotated += 1;
      else c.alreadyNew += 1;
    };

    const ai = await tx<{ provider: string; ciphertext: string }[]>`
      select provider, ciphertext from ai_provider_keys order by provider for update
    `;
    for (const row of ai) {
      const r = reencrypt(row.ciphertext, row.provider, oldKey, newKey, `Clé IA ${row.provider}`);
      if (r.changed) {
        await tx`
          update ai_provider_keys set ciphertext = ${r.value}, updated_at = now()
           where provider = ${row.provider}
        `;
      }
      count(result.aiKeys, r.changed);
    }

    const smtp = await tx<{ password_ciphertext: string }[]>`
      select password_ciphertext from smtp_settings
       where password_ciphertext is not null for update
    `;
    for (const row of smtp) {
      const r = reencrypt(
        row.password_ciphertext,
        SMTP_PASSWORD_AAD,
        oldKey,
        newKey,
        'Mot de passe SMTP',
      );
      if (r.changed) {
        await tx`update smtp_settings set password_ciphertext = ${r.value}, updated_at = now()`;
      }
      count(result.smtp, r.changed);
    }

    const hooks = await tx<{ id: string; secret_ciphertext: string }[]>`
      select id, secret_ciphertext from webhook_endpoints
       where secret_ciphertext is not null order by id for update
    `;
    for (const row of hooks) {
      const r = reencrypt(
        row.secret_ciphertext,
        webhookSecretAad(row.id),
        oldKey,
        newKey,
        `Secret du webhook ${row.id}`,
      );
      if (r.changed) {
        await tx`
          update webhook_endpoints set secret_ciphertext = ${r.value} where id = ${row.id}
        `;
      }
      count(result.webhooks, r.changed);
    }
    return result;
  });
}
