import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';

import type { TemplateBundle } from './engine.js';
import { TemplateManifestSchema, type TemplateManifest } from './manifest.js';

/**
 * Static checks of a template bundle (zip import, save_template, CLI check).
 * Files allowed: manifest.json, report.liquid, sections/*.liquid,
 * partials/*.liquid, report.css, print.css, preview.png. Nothing else.
 */

export const MAX_ZIP_BYTES = 2 * 1024 * 1024;
export const MAX_TEXT_FILE_BYTES = 256 * 1024;
export const MAX_PREVIEW_BYTES = 1024 * 1024;
export const MAX_FILES = 40;

const PATH_RE =
  /^(manifest\.json|report\.liquid|report\.css|print\.css|preview\.png|(sections|partials)\/[a-z0-9][a-z0-9_-]{0,40}\.liquid)$/;

export interface ValidationIssue {
  level: 'error' | 'warning';
  file: string | null;
  message: string;
}

export function isAllowedPath(p: string): boolean {
  return PATH_RE.test(p);
}

const FORBIDDEN_MARKUP: { re: RegExp; message: string }[] = [
  { re: /<\s*script\b/i, message: 'balise <script> interdite' },
  {
    re: /<\s*(iframe|frame|object|embed|applet)\b/i,
    message: 'contenu embarqué interdit (iframe, object, embed)',
  },
  { re: /<\s*(link|meta|base)\b/i, message: 'balises <link>, <meta>, <base> interdites' },
  { re: /<\s*form\b/i, message: 'formulaire interdit' },
  {
    re: /<\s*style\b/i,
    message: 'le CSS va dans report.css ou print.css, pas dans une balise <style>',
  },
  { re: /\son[a-z]+\s*=/i, message: 'attribut d’événement (onclick, onload…) interdit' },
  { re: /javascript\s*:/i, message: 'URL javascript: interdite' },
  {
    re: /\bsrc\s*=\s*["']?\s*(https?:)?\/\//i,
    message: 'image distante interdite (seulement /media ou des données du rapport)',
  },
];

const FORBIDDEN_CSS: { re: RegExp; message: string }[] = [
  { re: /@import\b/i, message: '@import interdit' },
  {
    re: /url\s*\(/i,
    message: 'url() interdit dans le CSS (les polices sont fournies par le moteur)',
  },
  {
    re: /@font-face\b/i,
    message: '@font-face interdit (choisis les polices dans Réglages > Polices)',
  },
  { re: /@page\b/i, message: '@page est géré par le moteur (A4, marges 16 mm)' },
  {
    re: /expression\s*\(|javascript:|behavior\s*:|-moz-binding/i,
    message: 'construction CSS dangereuse',
  },
  { re: /<\/?\s*style/i, message: 'balise style dans le CSS' },
];

const LIQUID_TAG_RE = /\{%-?\s*(include|render|layout)\s+([^\s%]+)/g;

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length;
}

/** Static validation. Errors block the import; warnings are shown. */
export function validateBundleFiles(
  files: Record<string, string>,
  preview: Uint8Array | null,
): { manifest: TemplateManifest | null; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const paths = Object.keys(files);
  if (paths.length > MAX_FILES)
    issues.push({ level: 'error', file: null, message: 'trop de fichiers' });
  for (const p of paths) {
    if (!isAllowedPath(p)) {
      issues.push({ level: 'error', file: p, message: 'fichier non autorisé dans un modèle' });
      continue;
    }
    if (byteLength(files[p] ?? '') > MAX_TEXT_FILE_BYTES) {
      issues.push({ level: 'error', file: p, message: 'fichier trop gros (256 Ko maximum)' });
    }
  }
  if (preview !== null) {
    if (preview.length > MAX_PREVIEW_BYTES) {
      issues.push({
        level: 'error',
        file: 'preview.png',
        message: 'aperçu trop gros (1 Mo maximum)',
      });
    } else if (
      !(preview[0] === 0x89 && preview[1] === 0x50 && preview[2] === 0x4e && preview[3] === 0x47)
    ) {
      issues.push({
        level: 'error',
        file: 'preview.png',
        message: 'preview.png n’est pas une image PNG',
      });
    }
  }

  let manifest: TemplateManifest | null = null;
  const rawManifest = files['manifest.json'];
  if (rawManifest === undefined) {
    issues.push({ level: 'error', file: 'manifest.json', message: 'manifest.json manquant' });
  } else {
    try {
      const parsed = TemplateManifestSchema.safeParse(JSON.parse(rawManifest));
      if (parsed.success) manifest = parsed.data;
      else {
        for (const i of parsed.error.issues.slice(0, 10)) {
          issues.push({
            level: 'error',
            file: 'manifest.json',
            message: `${i.path.join('.') || 'manifest'} : ${i.message}`,
          });
        }
      }
    } catch {
      issues.push({ level: 'error', file: 'manifest.json', message: 'JSON invalide' });
    }
  }
  if (files['report.liquid'] === undefined) {
    issues.push({ level: 'error', file: 'report.liquid', message: 'report.liquid manquant' });
  }
  if (files['report.css'] === undefined) {
    issues.push({ level: 'warning', file: 'report.css', message: 'pas de report.css' });
  }

  for (const [p, content] of Object.entries(files)) {
    if (p.endsWith('.liquid')) {
      for (const f of FORBIDDEN_MARKUP) {
        if (f.re.test(content)) issues.push({ level: 'error', file: p, message: f.message });
      }
      for (const m of content.matchAll(LIQUID_TAG_RE)) {
        const tag = m[1] ?? '';
        const target = (m[2] ?? '').replace(/^['"]|['"]$/g, '');
        if (tag === 'layout') {
          issues.push({ level: 'error', file: p, message: 'layout non pris en charge' });
          continue;
        }
        const name = target.endsWith('.liquid') ? target : `${target}.liquid`;
        if (!/^['"]/.test(m[2] ?? '')) {
          issues.push({
            level: 'error',
            file: p,
            message: `${tag} : nom de partiel entre guillemets requis`,
          });
        } else if (files[name] === undefined) {
          issues.push({
            level: 'error',
            file: p,
            message: `${tag} : partiel introuvable (${name})`,
          });
        }
      }
      if (/<\s*main\b/i.test(content)) {
        issues.push({ level: 'error', file: p, message: '<main> est déjà fourni par la page' });
      }
    }
    if (p.endsWith('.css')) {
      for (const f of FORBIDDEN_CSS) {
        if (f.re.test(content)) issues.push({ level: 'error', file: p, message: f.message });
      }
    }
  }
  return { manifest, issues };
}

/** Reads a template zip. Never extracts to disk; size and paths checked first. */
export function readTemplateZip(
  bytes: Uint8Array,
):
  | { ok: true; bundle: TemplateBundle; issues: ValidationIssue[] }
  | { ok: false; issues: ValidationIssue[] } {
  if (bytes.length > MAX_ZIP_BYTES) {
    return {
      ok: false,
      issues: [{ level: 'error', file: null, message: 'archive trop grosse (2 Mo maximum)' }],
    };
  }
  let entries: Record<string, Uint8Array>;
  let total = 0;
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > 8 * MAX_ZIP_BYTES) throw new Error('zip bomb');
        return !f.name.endsWith('/');
      },
    });
  } catch {
    return {
      ok: false,
      issues: [{ level: 'error', file: null, message: 'archive .zip illisible' }],
    };
  }
  // Accept a single top-level folder (template-id/...).
  const names = Object.keys(entries).filter(
    (n) => !n.startsWith('__MACOSX/') && !n.endsWith('.DS_Store'),
  );
  const prefix = (() => {
    const first = names[0]?.split('/')[0];
    if (first && names.every((n) => n.startsWith(`${first}/`)) && !isAllowedPath(names[0] ?? ''))
      return `${first}/`;
    return '';
  })();
  const files: Record<string, string> = {};
  let preview: Uint8Array | null = null;
  const issues: ValidationIssue[] = [];
  for (const n of names) {
    const rel = n.slice(prefix.length);
    if (!isAllowedPath(rel)) {
      issues.push({ level: 'error', file: rel, message: 'fichier non autorisé dans un modèle' });
      continue;
    }
    const data = entries[n] ?? new Uint8Array();
    if (rel === 'preview.png') preview = data;
    else files[rel] = strFromU8(data);
  }
  const res = validateBundleFiles(files, preview);
  issues.push(...res.issues);
  if (res.manifest === null || issues.some((i) => i.level === 'error'))
    return { ok: false, issues };
  return {
    ok: true,
    issues,
    bundle: {
      manifest: res.manifest,
      files,
      preview: preview ? Buffer.from(preview).toString('base64') : null,
      builtin: false,
    },
  };
}

/** Zip of a template, files under `<id>/`. */
export function writeTemplateZip(bundle: TemplateBundle): Uint8Array {
  const id = bundle.manifest.id;
  const tree: Zippable = {};
  for (const [p, content] of Object.entries(bundle.files)) {
    if (isAllowedPath(p)) tree[`${id}/${p}`] = strToU8(content);
  }
  if (bundle.preview)
    tree[`${id}/preview.png`] = new Uint8Array(Buffer.from(bundle.preview, 'base64'));
  return zipSync(tree, { level: 6 });
}
