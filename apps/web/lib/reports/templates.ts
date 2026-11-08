import 'server-only';

import {
  builtinTemplate,
  builtinTemplates,
  DEFAULT_TEMPLATE_ID,
  defaultTemplate,
  isBuiltinTemplateId,
  resolveSettings,
  resolveTemplateAlias,
  TemplateManifestSchema,
  type FontChoice,
  type SectionEntry,
  type SettingValue,
  type TemplateBundle,
  type TemplateManifest,
} from '@mynto/templates';

import { db, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * Report templates of the install: built-in ones (code) + the agency's own
 * (database), with their state (enabled, settings) and the default.
 */

export interface TemplateEntry {
  id: string;
  name: string;
  description: string;
  version: string;
  builtin: boolean;
  enabled: boolean;
  isDefault: boolean;
  basedOn: string | null;
  hasPreview: boolean;
  manifest: TemplateManifest;
  stored: Record<string, unknown>;
}

function customToBundle(row: {
  manifest: unknown;
  files: Record<string, string>;
  preview: string | null;
}): TemplateBundle | null {
  const parsed = TemplateManifestSchema.safeParse(row.manifest);
  if (!parsed.success) return null;
  return { manifest: parsed.data, files: row.files, preview: row.preview, builtin: false };
}

/** Bundle of a template (built-in or custom), null when unknown. */
export async function loadTemplateBundle(id: string): Promise<TemplateBundle | null> {
  // A retired built-in id (standard, compact, commercial) gives its replacement.
  const target = resolveTemplateAlias(id);
  if (isBuiltinTemplateId(target)) return builtinTemplate(target);
  try {
    const row = await db().reports.getCustom(id);
    return row === null ? null : customToBundle(row);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'template_read_failed');
    return null;
  }
}

export async function listTemplates(): Promise<TemplateEntry[]> {
  const [custom, states, settings] = await Promise.all([
    db().reports.listCustom(),
    db().reports.listStates(),
    db().reports.getSettings(),
  ]);
  const stateById = new Map(states.map((s) => [s.template_id, s]));
  const bundles: TemplateBundle[] = [
    ...builtinTemplates(),
    ...custom.map(customToBundle).filter((b): b is TemplateBundle => b !== null),
  ];
  return bundles.map((b) => {
    const st = stateById.get(b.manifest.id);
    return {
      id: b.manifest.id,
      name: b.manifest.name,
      description: b.manifest.description,
      version: b.manifest.version,
      builtin: b.builtin,
      enabled: st?.enabled ?? true,
      isDefault: resolveTemplateAlias(settings.default_template_id) === b.manifest.id,
      basedOn: b.manifest.based_on ?? null,
      hasPreview: b.preview !== null,
      manifest: b.manifest,
      stored: st?.settings ?? {},
    };
  });
}

export interface ResolvedTemplate {
  bundle: TemplateBundle;
  values: Record<string, SettingValue>;
  sections: SectionEntry[];
}

/**
 * Template to render an audit with: its own when set and still enabled,
 * else the install default, else Minimaliste. Retired built-in ids resolve to
 * their replacement (standard, compact -> minimal, commercial -> mynto), with
 * the settings saved under the old id when the new one has none. Never throws.
 */
export async function resolveTemplate(templateId: string | null): Promise<ResolvedTemplate> {
  let defaultId: string = DEFAULT_TEMPLATE_ID;
  let stored: Record<string, unknown> = {};
  let bundle: TemplateBundle | null = null;
  try {
    const settings = await db().reports.getSettings();
    defaultId = resolveTemplateAlias(settings.default_template_id);
    for (const raw of [templateId, defaultId]) {
      if (raw === null) continue;
      const id = resolveTemplateAlias(raw);
      const st =
        (await db().reports.getState(id)) ?? (id !== raw ? await db().reports.getState(raw) : null);
      if (st !== null && !st.enabled && id !== defaultId) continue;
      bundle = await loadTemplateBundle(id);
      if (bundle !== null) {
        stored = st?.settings ?? {};
        break;
      }
    }
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'template_resolve_failed');
  }
  if (bundle === null) {
    bundle = defaultTemplate();
    stored = {};
  }
  const { values, sections } = resolveSettings(bundle.manifest, stored);
  return { bundle, values, sections };
}

/** Fonts chosen in Réglages > Polices (custom files served from /media/fonts). */
export async function fontChoice(): Promise<FontChoice> {
  try {
    const s = await db().reports.getSettings();
    const url = (key: string | null): string | null => (key === null ? null : `/media/${key}`);
    return {
      heading: s.heading_font,
      body: s.body_font,
      custom:
        s.custom_font_name !== null
          ? {
              name: s.custom_font_name,
              regularUrl: url(s.custom_font_regular_key),
              boldUrl: url(s.custom_font_bold_key),
            }
          : null,
    };
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'font_settings_read_failed');
    return { heading: 'inter', body: 'inter', custom: null };
  }
}
