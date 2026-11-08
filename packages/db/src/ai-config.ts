import {
  AI_PROVIDERS,
  DEFAULT_AI_MODELS,
  type AiModels,
  type AiProvider,
  type AiRepo,
  type VisionProvider,
} from './repos/ai.js';
import { decryptSecret } from './secrets.js';

/**
 * Effective AI configuration: dashboard settings first (ai_settings +
 * encrypted ai_provider_keys), env vars as the fallback. Shared by the
 * scanner (read at job start, cached) and the web app (connection test,
 * settings page).
 */

export interface AiEnv {
  APP_ENCRYPTION_KEY?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  GEMINI_API_KEY?: string | undefined;
  MISTRAL_API_KEY?: string | undefined;
  AUDIT_LLM_PROVIDER?: string | undefined;
  AUDIT_LLM_MODEL?: string | undefined;
  VISION_LLM_PROVIDER?: string | undefined;
  VISION_LLM_MODEL?: string | undefined;
}

export type KeySource = 'dashboard' | 'env' | null;

export interface EffectiveCall<P extends string> {
  provider: P;
  model: string;
  /** Plaintext key, server side only. Never log it, never send it to a browser. */
  apiKey: string | null;
  keySource: KeySource;
}

export interface EffectiveAiConfig {
  narrative: EffectiveCall<AiProvider>;
  vision: EffectiveCall<VisionProvider>;
  /** Providers whose stored key could not be decrypted (wrong APP_ENCRYPTION_KEY). */
  undecryptable: AiProvider[];
}

function nonEmpty(v: string | undefined | null): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function envKey(env: AiEnv, provider: AiProvider): string | null {
  switch (provider) {
    case 'anthropic':
      return nonEmpty(env.ANTHROPIC_API_KEY);
    case 'gemini':
      return nonEmpty(env.GEMINI_API_KEY);
    case 'mistral':
      return nonEmpty(env.MISTRAL_API_KEY);
  }
}

function asProvider(v: string | undefined): AiProvider | null {
  return (AI_PROVIDERS as readonly string[]).includes(v ?? '') ? (v as AiProvider) : null;
}

export function narrativeModelFor(
  provider: AiProvider,
  models: AiModels,
  envModel: string | null,
): string {
  const stored = models[provider]?.narrative;
  return nonEmpty(stored) ?? envModel ?? DEFAULT_AI_MODELS[provider].narrative;
}

export function visionModelFor(
  provider: VisionProvider,
  models: AiModels,
  envModel: string | null,
): string {
  const stored = models[provider]?.vision;
  return nonEmpty(stored) ?? envModel ?? DEFAULT_AI_MODELS[provider].vision;
}

/** Decrypts the stored keys (provider -> plaintext). Bad ciphertexts are reported, not thrown. */
export async function loadStoredKeys(
  repo: Pick<AiRepo, 'getEncryptedKeys'>,
  masterKey: string | undefined,
): Promise<{ keys: Partial<Record<AiProvider, string>>; undecryptable: AiProvider[] }> {
  const rows = await repo.getEncryptedKeys();
  const keys: Partial<Record<AiProvider, string>> = {};
  const undecryptable: AiProvider[] = [];
  for (const r of rows) {
    try {
      keys[r.provider] = decryptSecret(r.ciphertext, masterKey, r.provider);
    } catch {
      undecryptable.push(r.provider);
    }
  }
  return { keys, undecryptable };
}

export async function resolveAiConfig(
  repo: Pick<AiRepo, 'getSettings' | 'getEncryptedKeys'>,
  env: AiEnv,
): Promise<EffectiveAiConfig> {
  const [settings, stored] = await Promise.all([
    repo.getSettings(),
    loadStoredKeys(repo, env.APP_ENCRYPTION_KEY),
  ]);

  const envNarrative = asProvider(env.AUDIT_LLM_PROVIDER) ?? 'anthropic';
  const envVision: VisionProvider = env.VISION_LLM_PROVIDER === 'gemini' ? 'gemini' : 'anthropic';
  const narrativeProvider = settings?.narrative_provider ?? envNarrative;
  const visionProvider = settings?.vision_provider ?? envVision;
  const models = settings?.models ?? {};

  // The env model only applies to the provider the env selects.
  const envNarrativeModel =
    narrativeProvider === envNarrative ? nonEmpty(env.AUDIT_LLM_MODEL) : null;
  const envVisionModel = visionProvider === envVision ? nonEmpty(env.VISION_LLM_MODEL) : null;

  const keyFor = (p: AiProvider): { apiKey: string | null; keySource: KeySource } => {
    const db = stored.keys[p];
    if (db !== undefined && db.length > 0) return { apiKey: db, keySource: 'dashboard' };
    const fromEnv = envKey(env, p);
    return fromEnv !== null
      ? { apiKey: fromEnv, keySource: 'env' }
      : { apiKey: null, keySource: null };
  };

  return {
    narrative: {
      provider: narrativeProvider,
      model: narrativeModelFor(narrativeProvider, models, envNarrativeModel),
      ...keyFor(narrativeProvider),
    },
    vision: {
      provider: visionProvider,
      model: visionModelFor(visionProvider, models, envVisionModel),
      ...keyFor(visionProvider),
    },
    undecryptable: stored.undecryptable,
  };
}
