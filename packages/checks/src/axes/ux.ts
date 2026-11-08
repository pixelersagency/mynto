import { buildAxis, fail, pass, verdict, warn } from '../score.js';
import type { AxisResult, CheckResult, DomFacts } from '../types.js';

export function evaluateUx(f: DomFacts): AxisResult {
  const c: CheckResult[] = [];

  // Mobile viewport
  if (!f.usesViewportMeta) {
    c.push(
      fail(
        'ux.viewport',
        'Compatibilité mobile',
        'Pas de viewport responsive : site non adapté mobile.',
      ),
    );
  } else {
    c.push(pass('ux.viewport', 'Compatibilité mobile', 'Viewport responsive présent.'));
  }

  // Navigation presence
  if (f.navItems === 0) {
    c.push(fail('ux.nav.empty', 'Navigation', 'Aucune navigation principale détectée.'));
  } else if (f.navItems > 14) {
    c.push(
      warn(
        'ux.nav.deep',
        'Navigation',
        `Navigation chargée (${String(f.navItems)} liens) : surcharge cognitive.`,
        f.navItems,
      ),
    );
  } else {
    c.push(
      pass('ux.nav.ok', 'Navigation', `${String(f.navItems)} liens de navigation.`, f.navItems),
    );
  }

  // Search
  c.push(
    verdict(
      'ux.search',
      'Recherche interne',
      f.hasSearch,
      'Champ de recherche présent.',
      'Pas de recherche interne (acceptable sur petit site).',
      'warn',
    ),
  );

  // Page structure (landmarks)
  const lm = f.landmarks;
  const landmarkCount = [lm.header, lm.nav, lm.main, lm.footer].filter(Boolean).length;
  if (landmarkCount <= 1) {
    c.push(
      warn(
        'ux.structure',
        'Structure de page',
        'Page peu structurée (header/nav/main/footer absents).',
        landmarkCount,
      ),
    );
  } else {
    c.push(
      pass(
        'ux.structure',
        'Structure de page',
        `${String(landmarkCount)}/4 repères de page présents.`,
        landmarkCount,
      ),
    );
  }

  // Footer presence (orientation / reassurance)
  c.push(
    verdict(
      'ux.footer',
      'Pied de page',
      lm.footer,
      'Pied de page présent.',
      'Aucun pied de page (liens utiles, réassurance).',
      'warn',
    ),
  );

  return buildAxis('ux', c);
}
