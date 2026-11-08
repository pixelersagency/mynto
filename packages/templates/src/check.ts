import { Parser } from 'htmlparser2';

import { ReportDataV1Schema, type ReportDataV1 } from './contract.js';
import { renderTemplate, TemplateRenderError, type TemplateBundle } from './engine.js';
import { exampleReportData } from './example.js';
import { DEFAULT_BODY_FONT, DEFAULT_HEADING_FONT } from './fonts.js';
import { validateBundleFiles, type ValidationIssue } from './validate.js';

/**
 * Server-side check of a template, without a browser: static validation,
 * render on the example data in web and print modes, and structural
 * accessibility lint of the output (one h1, heading order, alt texts, link
 * and button names, disclosures with a summary). The CLI `template:check`
 * adds axe-core in a real browser and a PDF print on top of this.
 */

export interface CheckReport {
  ok: boolean;
  issues: ValidationIssue[];
}

export function lintReportHtml(html: string, file = 'rendu'): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  let h1 = 0;
  let lastLevel = 0;
  const stack: { tag: string; text: string; label: boolean }[] = [];
  let summaries = 0;
  const parser = new Parser(
    {
      onopentag(name, attrs) {
        const m = /^h([1-6])$/.exec(name);
        if (m) {
          const level = Number(m[1]);
          if (level === 1) h1 += 1;
          if (lastLevel > 0 && level > lastLevel + 1) {
            issues.push({
              level: 'warning',
              file,
              message: `niveau de titre sauté (h${String(lastLevel)} puis h${String(level)})`,
            });
          }
          lastLevel = level;
        }
        if (name === 'img' && attrs.alt === undefined) {
          issues.push({ level: 'error', file, message: 'image sans attribut alt' });
        }
        if (name === 'details') {
          summaries = 0;
        }
        if (name === 'summary') summaries += 1;
        if (name === 'a' || name === 'button') {
          stack.push({
            tag: name,
            text: '',
            label: Boolean(attrs['aria-label'] ?? attrs.title),
          });
        }
      },
      ontext(text) {
        for (const s of stack) s.text += text;
      },
      onclosetag(name) {
        if (name === 'details') {
          if (summaries === 0) {
            issues.push({ level: 'error', file, message: '<details> sans <summary>' });
          }
        }
        if (name === 'a' || name === 'button') {
          const s = stack.pop();
          if (s && !s.label && s.text.trim().length === 0) {
            issues.push({ level: 'error', file, message: `${name} sans texte accessible` });
          }
        }
      },
    },
    { decodeEntities: true },
  );
  parser.write(html);
  parser.end();
  if (h1 !== 1) {
    issues.push({ level: 'error', file, message: `un seul h1 attendu, ${String(h1)} trouvé(s)` });
  }
  return issues;
}

export async function checkTemplateStatic(bundle: TemplateBundle): Promise<CheckReport> {
  const preview = bundle.preview ? new Uint8Array(Buffer.from(bundle.preview, 'base64')) : null;
  const { issues } = validateBundleFiles(bundle.files, preview);
  if (issues.some((i) => i.level === 'error')) return { ok: false, issues };
  for (const mode of ['web', 'print'] as const) {
    let data: ReportDataV1;
    try {
      data = ReportDataV1Schema.parse(exampleReportData(bundle, mode));
    } catch {
      issues.push({ level: 'error', file: null, message: 'données d’exemple invalides' });
      continue;
    }
    try {
      const out = await renderTemplate(bundle, data, {
        fonts: { heading: DEFAULT_HEADING_FONT, body: DEFAULT_BODY_FONT, custom: null },
      });
      issues.push(...lintReportHtml(out.html, `rendu ${mode === 'web' ? 'web' : 'PDF'}`));
    } catch (err) {
      issues.push({
        level: 'error',
        file: 'report.liquid',
        message: `rendu ${mode} : ${err instanceof TemplateRenderError ? err.message : 'erreur'}`,
      });
    }
  }
  return { ok: !issues.some((i) => i.level === 'error'), issues };
}
