import { db, pgErrorCode, resolveAiConfig, type EffectiveAiConfig } from '@mynto/db';

import { config } from '../config.js';
import { logger } from '../logger.js';

/**
 * Effective AI configuration for a job: dashboard settings (provider,
 * model, encrypted keys) first, env vars as fallback. Read at job start and
 * cached AI_CONFIG_CACHE_MS (30 s) so a key changed in the dashboard is
 * picked up by the next audits without a restart.
 *
 * The plaintext keys only live in this process memory; never log them.
 */

let cached: { at: number; value: EffectiveAiConfig } | null = null;

function envOnly(): Promise<EffectiveAiConfig> {
  return resolveAiConfig(
    { getSettings: () => Promise.resolve(null), getEncryptedKeys: () => Promise.resolve([]) },
    config,
  );
}

export async function getEffectiveAiConfig(now: number = Date.now()): Promise<EffectiveAiConfig> {
  if (cached !== null && now - cached.at < config.AI_CONFIG_CACHE_MS) return cached.value;
  let value: EffectiveAiConfig;
  try {
    value = await resolveAiConfig(db().ai, config);
    if (value.undecryptable.length > 0) {
      logger.warn(
        { providers: value.undecryptable },
        'ai_keys_undecryptable_check_app_encryption_key',
      );
    }
  } catch (err) {
    // DB unreachable or settings table missing: env keys keep audits running.
    logger.warn({ code: pgErrorCode(err) }, 'ai_settings_read_failed_using_env');
    value = await envOnly();
  }
  cached = { at: now, value };
  return value;
}

/** Test hook. */
export function clearAiConfigCache(): void {
  cached = null;
}
