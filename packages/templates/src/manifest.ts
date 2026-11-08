import { z } from 'zod';

import { REPORT_DATA_VERSION, SectionIdSchema, type SectionId } from './contract.js';

/**
 * manifest.json of a report template.
 *
 * Settings are declared here and rendered as a form in the dashboard
 * (Réglages > Modèles > Réglages du modèle). Their values reach the template
 * as `settings.<key>`; the special `sections` setting drives `sections`.
 */

export const TEMPLATE_ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/;
export const BUILTIN_TEMPLATE_IDS = ['minimal', 'bento', 'mynto'] as const;
export type BuiltinTemplateId = (typeof BUILTIN_TEMPLATE_IDS)[number];

/** Template of a new install, and fallback of every render. */
export const DEFAULT_TEMPLATE_ID: BuiltinTemplateId = 'minimal';

/**
 * Built-in templates retired in v2 and the one that replaces each. Audits and
 * settings saved with an old id keep rendering (migration 0010 rewrites the
 * stored ids; this map covers anything written before it ran). The old ids
 * stay reserved: no custom template can take them.
 */
export const LEGACY_TEMPLATE_ALIASES: Readonly<Record<string, BuiltinTemplateId>> = Object.freeze({
  standard: 'minimal',
  compact: 'minimal',
  commercial: 'mynto',
});

export function isBuiltinTemplateId(id: string): id is BuiltinTemplateId {
  return (BUILTIN_TEMPLATE_IDS as readonly string[]).includes(id);
}

/** Legacy built-in id -> its replacement; any other id unchanged. */
export function resolveTemplateAlias(id: string): string {
  return Object.prototype.hasOwnProperty.call(LEGACY_TEMPLATE_ALIASES, id)
    ? (LEGACY_TEMPLATE_ALIASES[id] ?? id)
    : id;
}

/** Ids a custom template cannot use: built-in ones and retired built-in ones. */
export function isReservedTemplateId(id: string): boolean {
  return isBuiltinTemplateId(id) || resolveTemplateAlias(id) !== id;
}

const KeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'clé en minuscules, chiffres et _');
const Label = z.string().trim().min(1).max(80);
const Help = z.string().trim().max(240).optional();

const BooleanSetting = z.object({
  key: KeySchema,
  type: z.literal('boolean'),
  label: Label,
  help: Help,
  default: z.boolean(),
});
const SelectSetting = z.object({
  key: KeySchema,
  type: z.literal('select'),
  label: Label,
  help: Help,
  options: z
    .array(z.object({ value: z.string().min(1).max(40), label: Label }))
    .min(2)
    .max(12),
  default: z.string(),
});
const TextSetting = z.object({
  key: KeySchema,
  type: z.enum(['text', 'textarea']),
  label: Label,
  help: Help,
  max: z.number().int().min(1).max(2000).default(200),
  default: z.string().max(2000),
});
const FontSetting = z.object({
  key: KeySchema,
  type: z.literal('font'),
  label: Label,
  help: Help,
  default: z.string().default('inherit'),
});
const SectionsSetting = z.object({
  key: z.literal('sections'),
  type: z.literal('sections'),
  label: Label,
  help: Help,
  default: z
    .array(z.object({ id: SectionIdSchema, enabled: z.boolean() }))
    .min(1)
    .max(SectionIdSchema.options.length),
});

export const TemplateSettingSchema = z.discriminatedUnion('type', [
  BooleanSetting,
  SelectSetting,
  TextSetting.extend({ type: z.literal('text') }),
  TextSetting.extend({ type: z.literal('textarea') }),
  FontSetting,
  SectionsSetting,
]);
export type TemplateSetting = z.infer<typeof TemplateSettingSchema>;

export const TemplateManifestSchema = z
  .object({
    id: z.string().regex(TEMPLATE_ID_PATTERN, 'id : minuscules, chiffres et tirets, 2 à 40'),
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(300).default(''),
    version: z.string().regex(/^\d+\.\d+\.\d+$/, 'version au format 1.0.0'),
    contract: z.object({
      name: z.literal('report-data'),
      version: z.literal(REPORT_DATA_VERSION),
    }),
    author: z.string().trim().max(80).optional(),
    based_on: z.string().regex(TEMPLATE_ID_PATTERN).optional(),
    settings: z.array(TemplateSettingSchema).max(40).default([]),
  })
  .strict()
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    for (const s of m.settings) {
      if (seen.has(s.key)) {
        ctx.addIssue({ code: 'custom', message: `réglage en double : ${s.key}` });
      }
      seen.add(s.key);
      if (s.type === 'select' && !s.options.some((o) => o.value === s.default)) {
        ctx.addIssue({ code: 'custom', message: `défaut hors des options : ${s.key}` });
      }
    }
  });
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

export type SettingValue = string | number | boolean | null;
export interface SectionEntry {
  id: SectionId;
  enabled: boolean;
}

/** Stored values -> complete values, every key of the manifest present. */
export function resolveSettings(
  manifest: TemplateManifest,
  stored: Record<string, unknown> | null | undefined,
): { values: Record<string, SettingValue>; sections: SectionEntry[] } {
  const values: Record<string, SettingValue> = {};
  let sections: SectionEntry[] = SectionIdSchema.options.map((id) => ({ id, enabled: true }));
  for (const s of manifest.settings) {
    const raw = stored?.[s.key];
    switch (s.type) {
      case 'boolean':
        values[s.key] = typeof raw === 'boolean' ? raw : s.default;
        break;
      case 'select':
        values[s.key] =
          typeof raw === 'string' && s.options.some((o) => o.value === raw) ? raw : s.default;
        break;
      case 'text':
      case 'textarea':
        values[s.key] = typeof raw === 'string' ? raw.slice(0, s.max) : s.default;
        break;
      case 'font':
        values[s.key] = typeof raw === 'string' && raw.length <= 60 ? raw : s.default;
        break;
      case 'sections': {
        const parsed = z
          .array(z.object({ id: SectionIdSchema, enabled: z.boolean() }))
          .safeParse(raw);
        const base = parsed.success ? parsed.data : s.default;
        // Unknown or missing sections are appended disabled, duplicates dropped.
        const seen = new Set<SectionId>();
        const out: SectionEntry[] = [];
        for (const e of base) {
          if (seen.has(e.id)) continue;
          seen.add(e.id);
          out.push({ id: e.id, enabled: e.enabled });
        }
        for (const d of s.default) {
          if (!seen.has(d.id)) out.push({ id: d.id, enabled: false });
        }
        sections = out;
        break;
      }
    }
  }
  return { values, sections };
}

/** Validates values posted by the settings form (unknown keys dropped). */
export function sanitizeSettingsInput(
  manifest: TemplateManifest,
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const s of manifest.settings) {
    if (!(s.key in input)) continue;
    const raw = input[s.key];
    if (s.type === 'sections') {
      const parsed = z
        .array(z.object({ id: SectionIdSchema, enabled: z.boolean() }))
        .max(SectionIdSchema.options.length)
        .safeParse(raw);
      if (parsed.success) out[s.key] = parsed.data;
    } else if (s.type === 'boolean') {
      out[s.key] = raw === true || raw === 'on' || raw === 'true';
    } else if (typeof raw === 'string') {
      if (s.type === 'select' && !s.options.some((o) => o.value === raw)) continue;
      out[s.key] =
        s.type === 'text' || s.type === 'textarea' ? raw.slice(0, s.max) : raw.slice(0, 60);
    }
  }
  return out;
}
