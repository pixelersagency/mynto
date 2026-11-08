import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { TemplateBundle } from './engine.js';
import { isAllowedPath, validateBundleFiles, type ValidationIssue } from './validate.js';

/** Reads a template folder from disk (CLI only, never used by the web app). */
export async function readTemplateDir(
  dir: string,
  builtin = false,
): Promise<{ bundle: TemplateBundle | null; issues: ValidationIssue[] }> {
  const files: Record<string, string> = {};
  const holder: { preview: Uint8Array | null } = { preview: null };
  const issues: ValidationIssue[] = [];
  const walk = async (rel: string): Promise<void> => {
    const entries = await readdir(path.join(dir, rel), { withFileTypes: true });
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.name.startsWith('.')) continue;
      if (e.isDirectory()) {
        await walk(p);
        continue;
      }
      if (!isAllowedPath(p)) {
        issues.push({ level: 'error', file: p, message: 'fichier non autorisé dans un modèle' });
        continue;
      }
      if (p === 'preview.png') holder.preview = new Uint8Array(await readFile(path.join(dir, p)));
      else files[p] = await readFile(path.join(dir, p), 'utf8');
    }
  };
  await walk('');
  const preview = holder.preview;
  const res = validateBundleFiles(files, preview);
  issues.push(...res.issues);
  if (res.manifest === null) return { bundle: null, issues };
  return {
    bundle: {
      manifest: res.manifest,
      files,
      preview: preview ? Buffer.from(preview).toString('base64') : null,
      builtin,
    },
    issues,
  };
}
