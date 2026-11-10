import { describe, expect, it } from 'vitest';

import { buildReportData } from '../src/build-data.js';
import { EXAMPLE_AGENCY, EXAMPLE_AUDIT, EXAMPLE_FINDINGS } from '../src/example.js';
import {
  BUILTIN_TEMPLATE_IDS,
  DEFAULT_TEMPLATE_ID,
  LEGACY_TEMPLATE_ALIASES,
  ReportDataV1Schema,
  builtinTemplate,
  contrastRatio,
  defaultTemplate,
  ensureContrastOnDark,
  exampleReportData,
  isReservedTemplateId,
  lintReportHtml,
  renderTemplate,
  resolveSettings,
  resolveTemplateAlias,
  type ReportDataV1,
  type TemplateBundle,
} from '../src/index.js';

const fonts = { heading: 'inter', body: 'inter', custom: null };

function bundle(id: string): TemplateBundle {
  const b = builtinTemplate(id);
  if (!b) throw new Error(`${id} missing`);
  return b;
}

async function render(id: string, data: ReportDataV1): Promise<string> {
  const out = await renderTemplate(bundle(id), ReportDataV1Schema.parse(data), { fonts });
  const errors = lintReportHtml(out.html).filter((i) => i.level === 'error');
  expect(errors, id).toEqual([]);
  return out.html;
}

/** Report data built like the app does, with the audit/findings overridden. */
function dataWith(
  id: string,
  audit: Partial<typeof EXAMPLE_AUDIT>,
  findings = EXAMPLE_FINDINGS,
  opts: { tracking?: boolean; contactUrl?: string | null; stored?: Record<string, unknown> } = {},
): ReportDataV1 {
  const b = bundle(id);
  const { values, sections } = resolveSettings(b.manifest, opts.stored ?? null);
  return buildReportData({
    audit: { ...EXAMPLE_AUDIT, ...audit },
    findings,
    agency: {
      ...EXAMPLE_AGENCY,
      contactUrl: opts.contactUrl === undefined ? EXAMPLE_AGENCY.contactUrl : opts.contactUrl,
    },
    context: {
      mode: 'web',
      shareUrl: 'https://exemple.fr/r/jeton',
      pdfUrl: '/api/audits/full/x/pdf',
      tracking: opts.tracking ?? true,
      label: null,
      faviconUrl: null,
      now: new Date('2026-11-06'),
    },
    template: { id, name: b.manifest.name, version: b.manifest.version, values, sections },
  });
}

describe('built-in templates v2', () => {
  it('ships minimal, bento and mynto, minimal by default', () => {
    expect([...BUILTIN_TEMPLATE_IDS]).toEqual(['minimal', 'bento', 'mynto']);
    expect(DEFAULT_TEMPLATE_ID).toBe('minimal');
    expect(defaultTemplate().manifest.id).toBe('minimal');
    for (const id of BUILTIN_TEMPLATE_IDS) {
      const m = bundle(id).manifest;
      const keys = m.settings.map((s) => s.key);
      expect(keys, id).toEqual(
        expect.arrayContaining([
          'sections',
          'intro',
          'cta_title',
          'cta_text',
          'cta_label',
          'offer',
          'footer_text',
          'open_issues',
          'show_code',
          'show_hero',
          'pdf_cover',
          'heading_font',
          'body_font',
        ]),
      );
      expect(bundle(id).preview, `${id}: preview.png`).not.toBeNull();
    }
  });

  it.each(BUILTIN_TEMPLATE_IDS)('%s renders every block with the full example data', async (id) => {
    const web = await render(id, exampleReportData(bundle(id), 'web'));
    for (const needle of [
      'id="confidentialite"',
      'href="#confidentialite"',
      'boulangerie-martin.fr peut faire mieux',
      'Radar des scores par axe',
      'Corriger l’essentiel',
      'Réserver un appel de 20 minutes',
      'Télécharger le PDF',
      'data-mynto-action="copy"',
      'Gain attendu',
      'À corriger en premier',
      'Préparation IA',
      'Pourquoi ça compte',
      'Atelier Pixel, studio web à Lyon',
      'Rapport valable jusqu’au',
      'Extrait de code',
    ]) {
      if (id === 'mynto' && needle === 'Pourquoi ça compte') continue;
      expect(web, `${id}: ${needle}`).toContain(needle);
    }
    expect(web.toLowerCase()).toContain('corrections chiffrées');
    const print = await render(id, exampleReportData(bundle(id), 'print'));
    expect(print).toContain('class="mr-cover"');
    expect(print).not.toContain('data-mynto-action="copy"');
    expect(print).not.toContain('href="#confidentialite"');
  });

  it.each(BUILTIN_TEMPLATE_IDS)(
    '%s renders a bare audit (no AI key, no cost, no AI module, no issue)',
    async (id) => {
      const data = dataWith(
        id,
        {
          exec_summary: null,
          estimated_impact_narrative: null,
          top3_priorities: [],
          quick_wins: [],
          cost_estimate: null,
          remediation: null,
          ai_readiness: null,
          llm_model: null,
          axis_scores: { ...EXAMPLE_AUDIT.axis_scores, performance: undefined } as never,
        },
        [],
        { tracking: false, contactUrl: null },
      );
      const html = await render(id, data);
      expect(html).toContain('Non évalué');
      expect(html).toContain('Aucun problème relevé');
      expect(html).not.toContain('Corriger l’essentiel');
      expect(html).not.toContain('Gain attendu');
      expect(html).not.toContain('confidentialite');
      expect(html).not.toContain('Réserver un appel');
      expect(html).not.toContain('synthèse rédigée avec l’aide d’une IA');
      // The axis not evaluated is labelled, never scored.
      expect(html).toMatch(/Perf <tspan class="mr-radar__value is-off">–<\/tspan>/);
      expect(html).toContain('Performance, non évalué');
    },
  );

  it.each(BUILTIN_TEMPLATE_IDS)('%s renders without any global score', async (id) => {
    const data = dataWith(id, { axis_scores: {}, global_score: null, global_band: null });
    const html = await render(id, data);
    expect(html).toContain(`Audit de ${data.audit.host}`);
    expect(html).toContain('Score global non évalué');
  });

  it.each(BUILTIN_TEMPLATE_IDS)('%s follows the sections setting', async (id) => {
    const none = dataWith(id, {}, EXAMPLE_FINDINGS, {
      stored: { sections: [{ id: 'axes', enabled: true }] },
    });
    const html = await render(id, none);
    expect(none.sections.filter((s) => s.enabled).map((s) => s.id)).toEqual(['axes']);
    expect(html).not.toContain('Le plan d’action');
    expect(html).not.toContain('Pourquoi ça compte');
    expect(html).not.toContain('Les 11 tests');
    // AI section off: its score joins the scores per axis.
    expect(html).toMatch(/Préparation IA/);
    // Links to findings are only rendered when the issues are on the page.
    expect(html).not.toContain('aria-label="Problèmes liés"');
  });

  it.each(BUILTIN_TEMPLATE_IDS)('%s escapes long and hostile texts, many issues', async (id) => {
    const evil = '<script>alert(1)</script><img src=x onerror=alert(1)>';
    const base = (i: number): (typeof EXAMPLE_FINDINGS)[number] => {
      const f = EXAMPLE_FINDINGS[i % EXAMPLE_FINDINGS.length];
      if (!f) throw new Error('no example finding');
      return f;
    };
    const many = Array.from({ length: 40 }, (_, i) => ({
      ...base(i),
      id: `f${String(i)}`,
      title: `${evil} ${'très long titre '.repeat(20)}`,
      narrative_constat: 'x'.repeat(3000),
      narrative_code_snippet: '<a href="javascript:alert(1)" onclick="x()">code</a>',
    }));
    const data = dataWith(id, { exec_summary: evil }, many as typeof EXAMPLE_FINDINGS);
    const html = await render(id, data);
    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/<img[^>]*onerror/);
    expect(html).not.toMatch(/<a[^>]*javascript:/);
    expect(html).toContain('&lt;a href="javascript:alert(1)"');
    expect(html.match(/class="mr-finding /g)?.length).toBe(40);
  });

  it('hides the code block when the snippet is empty or show_code is off', async () => {
    const blank = EXAMPLE_FINDINGS.map((f) => ({ ...f, narrative_code_snippet: '  ' }));
    expect(await render('minimal', dataWith('minimal', {}, blank))).not.toContain(
      'Extrait de code',
    );
    const off = dataWith('minimal', {}, EXAMPLE_FINDINGS, { stored: { show_code: false } });
    expect(await render('minimal', off)).not.toContain('Extrait de code');
  });

  it('collapses issue groups per open_issues', async () => {
    const all = await render('minimal', dataWith('minimal', {}));
    expect(all.match(/<details class="mr-group" id="axe-[^"]+" open/g)?.length).toBeGreaterThan(3);
    const none = await render(
      'minimal',
      dataWith('minimal', {}, EXAMPLE_FINDINGS, { stored: { open_issues: 'none' } }),
    );
    expect(none).not.toMatch(/<details class="mr-group" id="axe-[^"]+" open/);
  });

  it('mynto accent: peach by default, agency colour readable on the dark ground', async () => {
    const peach = await render('mynto', dataWith('mynto', {}));
    expect(peach).toContain('data-accent="peach"');
    const brand = dataWith('mynto', {}, EXAMPLE_FINDINGS, { stored: { accent: 'brand' } });
    expect(await render('mynto', brand)).toContain('data-accent="brand"');
    const out = await renderTemplate(bundle('mynto'), brand, { fonts });
    expect(out.css).toMatch(/--mr-brand-on-dark:#[0-9a-f]{6}/);
    for (const c of ['#1d4ed8', '#7c3aed', '#000000', '#b91c1c']) {
      const fixed = ensureContrastOnDark(c).color;
      expect(contrastRatio(fixed, '#2a1414'), c).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(fixed, '#3a1a1a'), c).toBeGreaterThanOrEqual(4.5);
    }
    expect(ensureContrastOnDark('#e9b48a').adjusted).toBe(false);
  });
});

describe('retired built-in ids', () => {
  it('map to their replacement and stay reserved', () => {
    expect(LEGACY_TEMPLATE_ALIASES).toEqual({
      standard: 'minimal',
      compact: 'minimal',
      commercial: 'mynto',
    });
    expect(resolveTemplateAlias('standard')).toBe('minimal');
    expect(resolveTemplateAlias('compact')).toBe('minimal');
    expect(resolveTemplateAlias('commercial')).toBe('mynto');
    expect(resolveTemplateAlias('maison')).toBe('maison');
    expect(resolveTemplateAlias('constructor')).toBe('constructor');
    expect(builtinTemplate('standard')?.manifest.id).toBe('minimal');
    expect(builtinTemplate('commercial')?.manifest.id).toBe('mynto');
    for (const id of ['standard', 'compact', 'commercial', 'minimal', 'bento', 'mynto']) {
      expect(isReservedTemplateId(id), id).toBe(true);
    }
    expect(isReservedTemplateId('maison')).toBe(false);
  });

  it('carry compatible saved settings over (old standard settings on minimal)', async () => {
    const stored = {
      sections: [
        { id: 'summary', enabled: true },
        { id: 'priorities', enabled: true },
        { id: 'passed', enabled: false },
      ],
      cta_label: 'Prendre rendez-vous',
      density: 'compact',
      open_issues: 'p0',
    };
    const b = bundle('standard');
    const { values, sections } = resolveSettings(b.manifest, stored);
    expect(values.cta_label).toBe('Prendre rendez-vous');
    expect(values.density).toBe('compact');
    expect(sections.slice(0, 3).map((s) => s.id)).toEqual(['summary', 'priorities', 'passed']);
    const html = await render('minimal', dataWith('minimal', {}, EXAMPLE_FINDINGS, { stored }));
    expect(html).toContain('Prendre rendez-vous');
  });
});

describe('cost section switch', () => {
  it.each([...BUILTIN_TEMPLATE_IDS])(
    '%s shows no price anywhere once the cost section is off',
    async (id) => {
      const on = await render(id, dataWith(id, {}));
      expect(on).toContain('€');
      const defaults = resolveSettings(bundle(id).manifest, null).sections;
      const stored = {
        sections: defaults.map((s) => (s.id === 'cost' ? { ...s, enabled: false } : s)),
      };
      const data = dataWith(id, {}, EXAMPLE_FINDINGS, { stored });
      expect(data.cost).toBeNull();
      const off = await render(id, data);
      expect(off).not.toContain('€ HT');
      expect(off).not.toContain('Corriger l’essentiel');
    },
  );
});
