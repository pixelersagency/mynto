import { buildAxis, fail, pass, verdict, warn } from '../score.js';
import type { AxisResult, CheckResult, DomFacts } from '../types.js';

export function evaluateAccessibilite(f: DomFacts): AxisResult {
  const c: CheckResult[] = [];

  // html lang
  c.push(
    verdict(
      'a11y.lang',
      'Langue du document',
      f.lang !== null,
      `Attribut lang="${f.lang ?? ''}".`,
      'Attribut lang manquant sur <html> (RGAA 8.3).',
      'fail',
    ),
  );

  // Viewport zoom
  if (f.viewportBlocksZoom) {
    c.push(
      fail(
        'a11y.zoom',
        'Zoom mobile',
        'Le zoom est bloqué (user-scalable=no) : critique RGAA/WCAG.',
      ),
    );
  } else {
    c.push(pass('a11y.zoom', 'Zoom mobile', 'Le zoom n’est pas bloqué.'));
  }

  // Image alt coverage
  if (f.imagesTotal > 0) {
    const decorative = f.imagesEmptyAlt;
    const informativeMissing = f.imagesTotal - f.imagesWithAlt - decorative;
    if (informativeMissing > 0) {
      c.push(
        fail(
          'a11y.alt',
          'Alternatives images',
          `${String(informativeMissing)} image(s) sans alternative textuelle (RGAA 1.1).`,
          `${String(f.imagesWithAlt)}/${String(f.imagesTotal)}`,
        ),
      );
    } else {
      c.push(pass('a11y.alt', 'Alternatives images', 'Toutes les images informatives ont un alt.'));
    }
  } else {
    c.push(pass('a11y.alt', 'Alternatives images', 'Aucune image à décrire.'));
  }

  // Form labels
  if (f.inputsWithoutLabel > 0) {
    c.push(
      fail(
        'a11y.labels',
        'Étiquettes de formulaire',
        `${String(f.inputsWithoutLabel)} champ(s) sans label associé (RGAA 11.1).`,
        f.inputsWithoutLabel,
      ),
    );
  } else if (f.formsCount > 0) {
    c.push(pass('a11y.labels', 'Étiquettes de formulaire', 'Tous les champs ont un label.'));
  }

  // Skip link
  c.push(
    verdict(
      'a11y.skip',
      'Lien d’évitement',
      f.hasSkipLink,
      'Lien d’évitement présent.',
      'Pas de lien d’évitement vers le contenu (RGAA 12.7).',
      'warn',
    ),
  );

  // Landmarks
  if (!f.landmarks.main) {
    c.push(warn('a11y.landmark.main', 'Repère principal', 'Aucune balise <main> ou role="main".'));
  } else {
    c.push(pass('a11y.landmark.main', 'Repère principal', 'Balise <main> présente.'));
  }
  if (!f.landmarks.nav) {
    c.push(
      warn('a11y.landmark.nav', 'Repère navigation', 'Aucune balise <nav> ou role="navigation".'),
    );
  } else {
    c.push(pass('a11y.landmark.nav', 'Repère navigation', 'Navigation balisée.'));
  }

  // Empty links
  if (f.linksNoText > 0) {
    c.push(
      fail(
        'a11y.link_text',
        'Intitulés de liens',
        `${String(f.linksNoText)} lien(s) sans intitulé accessible (RGAA 6.1).`,
        f.linksNoText,
      ),
    );
  } else {
    c.push(pass('a11y.link_text', 'Intitulés de liens', 'Tous les liens ont un intitulé.'));
  }

  // target=_blank without rel
  if (f.linksNewTabNoRel > 0) {
    c.push(
      warn(
        'a11y.new_tab',
        'Nouvelles fenêtres',
        `${String(f.linksNewTabNoRel)} lien(s) target="_blank" sans rel="noopener".`,
        f.linksNewTabNoRel,
      ),
    );
  }

  return buildAxis('accessibilite', c);
}
