import { z } from 'zod';

import { jsonb, type Sql } from '../client.js';

/**
 * ai_settings (single row) + ai_provider_keys. Keys arrive here already
 * encrypted (see ../secrets.ts); this repo never sees a plaintext key and
 * `listKeys` never returns ciphertext.
 */

export const AI_PROVIDERS = ['anthropic', 'gemini', 'mistral'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const VISION_PROVIDERS = ['anthropic', 'gemini'] as const;
export type VisionProvider = (typeof VISION_PROVIDERS)[number];

/** Built-in model ids, used when no model is set for a provider. */
export const DEFAULT_AI_MODELS = {
  anthropic: { narrative: 'claude-haiku-5-5', vision: 'claude-haiku-5-5' },
  gemini: { narrative: 'gemini-2.5-flash', vision: 'gemini-2.5-flash' },
  mistral: { narrative: 'mistral-large-latest' },
} as const;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,99}$/;

const optionalModel = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z
    .string()
    .trim()
    .regex(MODEL_ID, 'Identifiant de modèle invalide (lettres, chiffres, . _ : / @ -)')
    .nullable()
    .optional(),
);

export const AiModelsSchema = z
  .object({
    anthropic: z.object({ narrative: optionalModel, vision: optionalModel }).strict().optional(),
    gemini: z.object({ narrative: optionalModel, vision: optionalModel }).strict().optional(),
    mistral: z.object({ narrative: optionalModel }).strict().optional(),
  })
  .strict();
export type AiModels = z.infer<typeof AiModelsSchema>;

export const AiSettingsInputSchema = z.object({
  narrative_provider: z.enum(AI_PROVIDERS),
  vision_provider: z.enum(VISION_PROVIDERS),
  models: AiModelsSchema.default({}),
});
export type AiSettingsInput = z.infer<typeof AiSettingsInputSchema>;

export interface AiSettingsRow {
  narrative_provider: AiProvider;
  vision_provider: VisionProvider;
  models: AiModels;
  updated_at: string;
}

export interface AiKeyInfo {
  provider: AiProvider;
  key_hint: string;
  updated_at: string;
}

export function createAiRepo(sql: Sql) {
  return {
    async getSettings(): Promise<AiSettingsRow | null> {
      const [row] = await sql<AiSettingsRow[]>`
        select narrative_provider, vision_provider, models, updated_at from ai_settings where id
      `;
      if (row === undefined) return null;
      const models = AiModelsSchema.safeParse(row.models);
      return { ...row, models: models.success ? models.data : {} };
    },

    async saveSettings(input: AiSettingsInput): Promise<AiSettingsRow> {
      const v = AiSettingsInputSchema.parse(input);
      const [row] = await sql<AiSettingsRow[]>`
        insert into ai_settings (id, narrative_provider, vision_provider, models)
        values (true, ${v.narrative_provider}, ${v.vision_provider}, ${jsonb(sql, v.models)})
        on conflict (id) do update set
          narrative_provider = excluded.narrative_provider,
          vision_provider = excluded.vision_provider,
          models = excluded.models,
          updated_at = now()
        returning narrative_provider, vision_provider, models, updated_at
      `;
      if (row === undefined) throw new Error('ai_settings upsert returned no row');
      return row;
    },

    /** Stored keys, masked. Never the ciphertext. */
    async listKeys(): Promise<AiKeyInfo[]> {
      return sql<AiKeyInfo[]>`
        select provider, key_hint, updated_at from ai_provider_keys order by provider
      `;
    },

    /** Encrypted keys, for server-side decryption only (scanner, connection test). */
    async getEncryptedKeys(): Promise<{ provider: AiProvider; ciphertext: string }[]> {
      return sql<{ provider: AiProvider; ciphertext: string }[]>`
        select provider, ciphertext from ai_provider_keys
      `;
    },

    async setKey(provider: AiProvider, ciphertext: string, keyHint: string): Promise<void> {
      if (!(AI_PROVIDERS as readonly string[]).includes(provider)) throw new Error('bad provider');
      await sql`
        insert into ai_provider_keys (provider, ciphertext, key_hint)
        values (${provider}, ${ciphertext}, ${keyHint})
        on conflict (provider) do update set
          ciphertext = excluded.ciphertext, key_hint = excluded.key_hint, updated_at = now()
      `;
    },

    async deleteKey(provider: AiProvider): Promise<boolean> {
      const res = await sql`delete from ai_provider_keys where provider = ${provider}`;
      return res.count > 0;
    },
  };
}

export type AiRepo = ReturnType<typeof createAiRepo>;
