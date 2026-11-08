import { buildAxis, fail, info, pass, warn } from '../score.js';
import type { AxisResult, CheckResult, DomFacts } from '../types.js';

export function evaluateUi(f: DomFacts): AxisResult {
  const c: CheckResult[] = [];

  // Dated tech markers (deterministic — the code concludes "dated")
  const datedReasons: string[] = [];
  if (f.jqueryMajor !== null && f.jqueryMajor <= 1)
    datedReasons.push(`jQuery ${String(f.jqueryMajor)}.x`);
  if (f.bootstrapMajor !== null && f.bootstrapMajor <= 3)
    datedReasons.push(`Bootstrap ${String(f.bootstrapMajor)}.x`);
  if (f.deprecatedTags.length > 0) datedReasons.push(`balises <${f.deprecatedTags.join('>, <')}>`);
  if (f.flashDetected) datedReasons.push('Flash');
  if (f.legacyDoctype) datedReasons.push('doctype legacy');
  if (f.layoutTables > 0) datedReasons.push(`${String(f.layoutTables)} table(s) de mise en page`);

  if (datedReasons.length > 0) {
    c.push(
      fail(
        'ui.dated',
        'Stack technique',
        `Marqueurs datés : ${datedReasons.join(', ')}.`,
        datedReasons.length,
      ),
    );
  } else {
    c.push(pass('ui.dated', 'Stack technique', 'Aucun marqueur technique daté.'));
  }

  // Font discipline
  if (f.fontFamilies.length === 0) {
    c.push(info('ui.fonts', 'Typographies', 'Polices non mesurables sur cette page.'));
  } else if (f.fontFamilies.length >= 4) {
    c.push(
      warn(
        'ui.fonts',
        'Typographies',
        `${String(f.fontFamilies.length)} familles de polices : manque de cohérence.`,
        f.fontFamilies.length,
      ),
    );
  } else {
    c.push(
      pass(
        'ui.fonts',
        'Typographies',
        `${String(f.fontFamilies.length)} famille(s) de polices.`,
        f.fontFamilies.length,
      ),
    );
  }

  // Color discipline
  if (f.colorCount === 0) {
    c.push(info('ui.colors', 'Palette', 'Couleurs non mesurables sur cette page.'));
  } else if (f.colorCount > 18) {
    c.push(
      warn(
        'ui.colors',
        'Palette',
        `Palette dispersée (${String(f.colorCount)} couleurs échantillonnées).`,
        f.colorCount,
      ),
    );
  } else {
    c.push(
      pass(
        'ui.colors',
        'Palette',
        `${String(f.colorCount)} couleurs échantillonnées.`,
        f.colorCount,
      ),
    );
  }

  // Inline style smell
  if (f.inlineStyleBytes > 30_000) {
    c.push(
      warn(
        'ui.inline',
        'Styles inline',
        `${String(Math.round(f.inlineStyleBytes / 1024))} Ko de styles inline (design peu maintenable).`,
        f.inlineStyleBytes,
      ),
    );
  } else {
    c.push(pass('ui.inline', 'Styles inline', 'Styles inline raisonnables.'));
  }

  // Brand colour signal
  if (f.themeColor) {
    c.push(pass('ui.theme', 'Couleur de marque', `theme-color défini (${f.themeColor}).`));
  }

  // Subjective note
  c.push(
    info(
      'ui.note',
      'Analyse design complète',
      'La grille design experte (9 critères) est dans le rapport complet.',
    ),
  );

  return buildAxis('ui', c);
}
