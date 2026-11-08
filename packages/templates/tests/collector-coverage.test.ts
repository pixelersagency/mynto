import { expect, it } from 'vitest';

import { buildReportData } from '../src/build-data.js';
import { EXAMPLE_AUDIT, EXAMPLE_FINDINGS, EXAMPLE_AGENCY } from '../src/example.js';
import { builtinTemplate, resolveSettings, renderTemplate } from '../src/index.js';

it('missing scores are not evaluated, excluded from coverage, and render no disabled-module claim', async () => {
  const bundle = builtinTemplate('minimal');
  if (!bundle) throw new Error('missing minimal');
  const { values, sections } = resolveSettings(bundle.manifest, null);
  const data = buildReportData({
    audit: { ...EXAMPLE_AUDIT, axis_scores: {}, global_score: null, global_band: null },
    findings: EXAMPLE_FINDINGS,
    agency: EXAMPLE_AGENCY,
    context: {
      mode: 'web',
      shareUrl: 'https://example.com/report',
      pdfUrl: '/report.pdf',
      tracking: false,
      label: null,
      faviconUrl: null,
      now: new Date('2026-11-06'),
    },
    template: {
      id: bundle.manifest.id,
      name: bundle.manifest.name,
      version: bundle.manifest.version,
      values,
      sections,
    },
  });
  expect(data.axes.every((a) => !a.evaluated && a.score.value === null)).toBe(true);
  expect(data.score.evaluated_axes).toBe(0);
  expect(data.score.value).toBeNull();
  const output = await renderTemplate(bundle, data, {
    fonts: { heading: 'inter', body: 'inter', custom: null },
  });
  expect(output.html).toContain('Non évalué');
  expect(output.html).not.toContain('Module désactivé pour cet audit');
  expect(output.html).toContain(EXAMPLE_FINDINGS[0]?.title);
});
