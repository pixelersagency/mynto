import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { readTemplateDir } from '../src/disk.js';
import {
  BUILTIN_TEMPLATE_IDS,
  ReportDataV1Schema,
  builtinTemplate,
  builtinTemplates,
  checkTemplateStatic,
  contrastRatio,
  ensureContrast,
  exampleReportData,
  hoistKeyframes,
  lintReportHtml,
  readTemplateZip,
  renderTemplate,
  reportDataJsonSchema,
  resolveSettings,
  sanitizeSettingsInput,
  validateBundleFiles,
  writeTemplateZip,
  type TemplateBundle,
} from '../src/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fonts = { heading: 'inter', body: 'inter', custom: null };

function std(): TemplateBundle {
  const b = builtinTemplate('minimal');
  if (!b) throw new Error('minimal missing');
  return b;
}

describe('built-in templates', () => {
  it('generated bundle matches the builtin folders', async () => {
    for (const id of BUILTIN_TEMPLATE_IDS) {
      const disk = await readTemplateDir(path.join(HERE, '..', 'builtin', id), true);
      expect(disk.bundle?.files, `${id}: run pnpm --filter @mynto/templates bundle`).toEqual(
        builtinTemplate(id)?.files,
      );
    }
  });

  it.each(BUILTIN_TEMPLATE_IDS)('%s passes the static check in web and print modes', async (id) => {
    const b = builtinTemplate(id);
    expect(b).not.toBeNull();
    if (b === null) throw new Error(id);
    const report = await checkTemplateStatic(b);
    expect(report.issues.filter((i) => i.level === 'error')).toEqual([]);
  });

  it('example data follows the contract and the JSON schema exists', () => {
    for (const b of builtinTemplates()) {
      expect(() => ReportDataV1Schema.parse(exampleReportData(b))).not.toThrow();
    }
    const schema = reportDataJsonSchema();
    expect(JSON.stringify(schema)).toContain('ReportDataV1');
  });
});

describe('sandbox', () => {
  it('escapes report data, even through raw', async () => {
    const b = std();
    const files = {
      ...b.files,
      'report.liquid':
        '<h1>{{ audit.name }}</h1><p>{{ summary.text }}</p><p>{{ summary.text | raw }}</p>',
    };
    const data = exampleReportData(b);
    data.summary.text = '<script>alert(1)</script><img src=x onerror=alert(1)>';
    const out = await renderTemplate({ ...b, files }, data, { fonts });
    expect(out.html).not.toContain('<script');
    expect(out.html).not.toMatch(/<img[^>]*onerror/);
    expect(out.html).toContain('&lt;script&gt;');
  });

  it('sanitizes markup written in the template itself', async () => {
    const b = std();
    const files = {
      ...b.files,
      'report.liquid':
        '<h1 onclick="x()">T</h1><img src="https://tracker.example/p.gif" alt=""><a href="javascript:alert(1)">x</a><iframe src="/"></iframe><a href="https://ex.com">lien</a>',
    };
    const out = await renderTemplate({ ...b, files }, exampleReportData(b), { fonts });
    expect(out.html).not.toMatch(/onclick|tracker\.example|javascript:|<iframe/);
    expect(out.html).toContain('rel="noopener noreferrer"');
  });

  it('cannot include a file outside the template', async () => {
    const b = std();
    const files = { ...b.files, 'report.liquid': "{% include '../../../etc/passwd' %}" };
    await expect(
      renderTemplate({ ...b, files }, exampleReportData(b), { fonts }),
    ).rejects.toThrow();
  });

  it('nests template CSS under the report root and hoists keyframes', async () => {
    const b = std();
    const out = await renderTemplate(b, exampleReportData(b), { fonts });
    expect(out.css).toContain('.mynto-report{');
    expect(out.css).toContain("url('/fonts/inter-latin-400-normal.woff2')");
    const anim = await renderTemplate(
      { ...b, files: { ...b.files, 'report.css': '@keyframes k{from{opacity:0}to{opacity:1}}' } },
      exampleReportData(b),
      { fonts },
    );
    expect(anim.css).toMatch(/@keyframes k/);
    const h = hoistKeyframes('a{b:c}@keyframes k{from{x:1}to{x:2}}d{e:f}');
    expect(h.keyframes).toEqual(['@keyframes k{from{x:1}to{x:2}}']);
    expect(h.rest).toBe('a{b:c}d{e:f}');
  });

  it('expands every section in print mode', async () => {
    const b = std();
    const data = exampleReportData(b, 'print');
    expect(data.axes.every((a) => a.open_by_default)).toBe(true);
    const out = await renderTemplate(b, data, { fonts });
    expect(out.html).not.toContain('data-mynto-action="copy"');
  });
});

describe('validation and zip', () => {
  it('rejects scripts, remote CSS and unknown files', () => {
    const b = std();
    const bad = {
      ...b.files,
      'report.liquid': '<h1>x</h1><script>1</script>',
      'report.css': '@import url(https://evil.example/x.css);',
      'evil.js': 'x',
    };
    const { issues } = validateBundleFiles(bad, null);
    const msgs = issues.filter((i) => i.level === 'error').map((i) => i.message);
    expect(msgs).toEqual(
      expect.arrayContaining([
        'balise <script> interdite',
        '@import interdit',
        'fichier non autorisé dans un modèle',
      ]),
    );
  });

  it('requires quoted literal partial names that exist', () => {
    const b = std();
    const { issues } = validateBundleFiles(
      { ...b.files, 'report.liquid': '{% include audit.sector %}{% include "sections/nope" %}' },
      null,
    );
    expect(issues.map((i) => i.message).join(' ')).toMatch(/guillemets/);
    expect(issues.map((i) => i.message).join(' ')).toMatch(/introuvable/);
  });

  it('round-trips through a zip and refuses oversize archives', () => {
    const b = std();
    const zip = writeTemplateZip(b);
    const back = readTemplateZip(zip);
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.bundle.files).toEqual(b.files);
    const huge = new Uint8Array(2 * 1024 * 1024 + 1);
    expect(readTemplateZip(huge).ok).toBe(false);
  });
});

describe('settings, colors, lint', () => {
  it('resolves settings with defaults and section order', () => {
    const b = std();
    const r = resolveSettings(b.manifest, {
      open_issues: 'all',
      sections: [{ id: 'cta', enabled: true }],
      bogus: 1,
    });
    expect(r.values.open_issues).toBe('all');
    expect(r.sections[0]).toEqual({ id: 'cta', enabled: true });
    expect(r.sections.length).toBe(8);
    expect(sanitizeSettingsInput(b.manifest, { open_issues: 'nope', show_code: 'on' })).toEqual({
      show_code: true,
    });
  });

  it('darkens a light brand color until text reaches 4.5:1', () => {
    const r = ensureContrast('#fbbf24');
    expect(r.adjusted).toBe(true);
    expect(contrastRatio(r.color, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(ensureContrast('#1d4ed8').adjusted).toBe(false);
  });

  it('flags missing h1 and unnamed links', () => {
    const issues = lintReportHtml('<h2>x</h2><a href="#"></a><img src="/a.png">');
    expect(issues.map((i) => i.message).join(' ')).toMatch(/h1.*|sans texte|alt/);
    expect(issues.length).toBeGreaterThanOrEqual(3);
  });
});
