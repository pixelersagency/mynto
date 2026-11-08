import { BUILTIN_TEMPLATE_FILES } from './builtin.generated.js';
import type { TemplateBundle } from './engine.js';
import {
  BUILTIN_TEMPLATE_IDS,
  DEFAULT_TEMPLATE_ID,
  TemplateManifestSchema,
  resolveTemplateAlias,
} from './manifest.js';

/**
 * Built-in templates, compiled into the bundle (src/builtin.generated.ts is
 * written by `pnpm --filter @mynto/templates bundle` from builtin/<id>/), so
 * the web app never reads template files from disk at runtime.
 */

let cache: TemplateBundle[] | null = null;

export function builtinTemplates(): TemplateBundle[] {
  if (cache !== null) return cache;
  cache = BUILTIN_TEMPLATE_IDS.map((id) => {
    const entry = BUILTIN_TEMPLATE_FILES[id];
    const manifest = TemplateManifestSchema.parse(JSON.parse(entry.files['manifest.json'] ?? '{}'));
    return { manifest, files: { ...entry.files }, preview: entry.preview, builtin: true };
  });
  return cache;
}

/** Built-in template by id. A retired id (standard, compact, commercial) gives its replacement. */
export function builtinTemplate(id: string): TemplateBundle | null {
  const target = resolveTemplateAlias(id);
  return builtinTemplates().find((t) => t.manifest.id === target) ?? null;
}

/** The default template (Minimaliste), always present: fallback of every render. */
export function defaultTemplate(): TemplateBundle {
  const t = builtinTemplate(DEFAULT_TEMPLATE_ID);
  if (t === null) throw new Error('default template missing from the bundle');
  return t;
}
