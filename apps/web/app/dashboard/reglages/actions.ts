'use server';

import {
  AI_PROVIDERS,
  AiSettingsInputSchema,
  ApiKeyNameSchema,
  encryptSecret,
  hasValidMasterKey,
  loadStoredKeys,
  maskSecret,
  narrativeModelFor,
  visionModelFor,
  type AiProvider,
} from '@mynto/db';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { testProviderConnection } from '@/lib/ai/test-connection';
import { requireAdminMutation } from '@/lib/auth/origin';
import { modulesFromForm } from '@/lib/dashboard/modules-form';
import { db, pgErrorCode } from '@/lib/db';
import { getServerEnv } from '@/lib/env';
import { logger } from '@/lib/logger';

/**
 * Settings mutations: audit modules, AI providers and keys, API keys.
 * Every action checks the admin session and the Origin first. Secrets
 * (AI keys typed here, API key secrets) are never logged; an AI key never
 * leaves the server once saved; an API key secret is returned once, by
 * createApiKeyAction, and never again.
 */

export interface SettingsState {
  ok: boolean;
  message: string | null;
  fieldErrors?: Record<string, string>;
}

const ProviderSchema = z.enum(AI_PROVIDERS);

// ---------------------------------------------------------------------------
// Modules d'audit
// ---------------------------------------------------------------------------

export async function saveModulesAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  await requireAdminMutation();
  const parsed = modulesFromForm(form);
  if (!parsed.ok) return { ok: false, message: parsed.error, fieldErrors: { axes: parsed.error } };
  try {
    await db().auditSettings.saveModules(parsed.modules);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'modules_save_failed');
    return { ok: false, message: 'Enregistrement impossible pour le moment.' };
  }
  revalidatePath('/dashboard', 'layout');
  return { ok: true, message: 'Modules enregistrés. Ils s’appliquent aux prochains audits.' };
}

// ---------------------------------------------------------------------------
// IA
// ---------------------------------------------------------------------------

function field(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === 'string' ? v : '';
}

export async function saveAiSettingsAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  await requireAdminMutation();
  const parsed = AiSettingsInputSchema.safeParse({
    narrative_provider: field(form, 'narrative_provider'),
    vision_provider: field(form, 'vision_provider'),
    models: {
      anthropic: {
        narrative: field(form, 'model_anthropic_narrative'),
        vision: field(form, 'model_anthropic_vision'),
      },
      gemini: {
        narrative: field(form, 'model_gemini_narrative'),
        vision: field(form, 'model_gemini_vision'),
      },
      mistral: { narrative: field(form, 'model_mistral_narrative') },
    },
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key =
        issue.path[0] === 'models'
          ? `model_${issue.path.slice(1).join('_')}`
          : String(issue.path[0]);
      fieldErrors[key] ??= issue.message;
    }
    return { ok: false, message: 'Corrige les champs signalés.', fieldErrors };
  }
  try {
    await db().ai.saveSettings(parsed.data);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'ai_settings_save_failed');
    return { ok: false, message: 'Enregistrement impossible pour le moment.' };
  }
  revalidatePath('/dashboard/reglages/ia');
  return { ok: true, message: 'Réglages IA enregistrés. Le scanner les lit sous 30 secondes.' };
}

const ApiKeyValueSchema = z
  .string()
  .trim()
  .min(8, 'Clé trop courte.')
  .max(500, 'Clé trop longue.')
  .regex(/^\S+$/, 'La clé ne doit pas contenir d’espace.');

export async function saveAiKeyAction(
  _prev: SettingsState,
  form: FormData,
): Promise<SettingsState> {
  await requireAdminMutation();
  const provider = ProviderSchema.safeParse(form.get('provider'));
  if (!provider.success) return { ok: false, message: 'Fournisseur inconnu.' };
  const masterKey = getServerEnv().APP_ENCRYPTION_KEY;
  if (!hasValidMasterKey(masterKey)) {
    return {
      ok: false,
      message:
        'Enregistrement refusé : APP_ENCRYPTION_KEY manque ou n’a pas 32 octets (base64 ou hex). Ajoute-la au web et au scanner (openssl rand -base64 32), puis redémarre.',
    };
  }
  const key = ApiKeyValueSchema.safeParse(form.get('api_key'));
  if (!key.success) {
    return {
      ok: false,
      message: null,
      fieldErrors: { api_key: key.error.issues[0]?.message ?? 'Clé invalide.' },
    };
  }
  try {
    await db().ai.setKey(
      provider.data,
      encryptSecret(key.data, masterKey, provider.data),
      maskSecret(key.data),
    );
  } catch (err) {
    logger.error({ code: pgErrorCode(err), provider: provider.data }, 'ai_key_save_failed');
    return { ok: false, message: 'Enregistrement impossible pour le moment.' };
  }
  logger.info({ provider: provider.data }, 'ai_key_saved');
  revalidatePath('/dashboard/reglages/ia');
  return { ok: true, message: 'Clé enregistrée et chiffrée.' };
}

export async function deleteAiKeyAction(provider: AiProvider): Promise<SettingsState> {
  await requireAdminMutation();
  const p = ProviderSchema.safeParse(provider);
  if (!p.success) return { ok: false, message: 'Fournisseur inconnu.' };
  try {
    await db().ai.deleteKey(p.data);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'ai_key_delete_failed');
    return { ok: false, message: 'Suppression impossible pour le moment.' };
  }
  logger.info({ provider: p.data }, 'ai_key_deleted');
  revalidatePath('/dashboard/reglages/ia');
  return { ok: true, message: 'Clé supprimée.' };
}

const PurposeSchema = z.enum(['narrative', 'vision']);

/** Minimal authenticated call to the provider, with the stored key (env as fallback). */
export async function testAiConnectionAction(
  providerRaw: AiProvider,
  purposeRaw: 'narrative' | 'vision',
): Promise<SettingsState> {
  await requireAdminMutation();
  const provider = ProviderSchema.safeParse(providerRaw);
  const purpose = PurposeSchema.safeParse(purposeRaw);
  if (!provider.success || !purpose.success) return { ok: false, message: 'Requête invalide.' };
  const env = getServerEnv();
  let stored: string | undefined;
  let models = {};
  try {
    const [keys, settings] = await Promise.all([
      loadStoredKeys(db().ai, env.APP_ENCRYPTION_KEY),
      db().ai.getSettings(),
    ]);
    if (keys.undecryptable.includes(provider.data)) {
      return {
        ok: false,
        message:
          'La clé enregistrée ne se déchiffre pas : APP_ENCRYPTION_KEY a changé. Remplace la clé.',
      };
    }
    stored = keys.keys[provider.data];
    models = settings?.models ?? {};
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'ai_test_read_failed');
    return { ok: false, message: 'Base de données indisponible.' };
  }
  const envKey =
    provider.data === 'anthropic'
      ? env.ANTHROPIC_API_KEY
      : provider.data === 'gemini'
        ? env.GEMINI_API_KEY
        : env.MISTRAL_API_KEY;
  const apiKey = stored ?? envKey;
  if (!apiKey) return { ok: false, message: 'Aucune clé enregistrée pour ce fournisseur.' };
  const model =
    purpose.data === 'vision' && provider.data !== 'mistral'
      ? visionModelFor(provider.data, models, null)
      : narrativeModelFor(provider.data, models, null);
  const res = await testProviderConnection(provider.data, apiKey, model);
  logger.info({ provider: provider.data, ok: res.ok }, 'ai_connection_tested');
  return res;
}

// ---------------------------------------------------------------------------
// API et MCP
// ---------------------------------------------------------------------------

export interface CreatedKeyState extends SettingsState {
  /** Full secret, shown once in the browser. Never stored client-side. */
  secret?: string;
  prefix?: string;
}

export async function createApiKeyAction(
  _prev: CreatedKeyState,
  form: FormData,
): Promise<CreatedKeyState> {
  await requireAdminMutation();
  const name = ApiKeyNameSchema.safeParse(form.get('name'));
  if (!name.success) {
    return {
      ok: false,
      message: null,
      fieldErrors: { name: name.error.issues[0]?.message ?? 'Nom invalide.' },
    };
  }
  try {
    const created = await db().apiKeys.create(name.data);
    logger.info({ keyId: created.id }, 'api_key_created');
    revalidatePath('/dashboard/reglages/api');
    return {
      ok: true,
      message: 'Clé créée. Copie-la maintenant : elle ne sera plus affichée.',
      secret: created.secret,
      prefix: created.prefix,
    };
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'api_key_create_failed');
    return { ok: false, message: 'Création impossible pour le moment.' };
  }
}

export async function revokeApiKeyAction(id: string): Promise<SettingsState> {
  await requireAdminMutation();
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return { ok: false, message: 'Clé inconnue.' };
  try {
    const done = await db().apiKeys.revoke(parsed.data);
    logger.info({ keyId: parsed.data, done }, 'api_key_revoked');
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'api_key_revoke_failed');
    return { ok: false, message: 'Révocation impossible pour le moment.' };
  }
  revalidatePath('/dashboard/reglages/api');
  return { ok: true, message: 'Clé révoquée. Les appels avec cette clé sont refusés.' };
}
