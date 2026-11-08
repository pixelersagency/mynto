import { buildAxis, fail, info, pass, verdict, warn } from '../score.js';
import type { AxisResult, CheckResult, DomFacts } from '../types.js';

export function evaluateSeoTechnique(f: DomFacts): AxisResult {
  const c: CheckResult[] = [];

  // Title
  if (!f.title) {
    c.push(fail('seo.title.missing', 'Balise title', 'Aucune balise <title>.'));
  } else if (f.title.length > 60) {
    c.push(
      warn(
        'seo.title.length',
        'Balise title',
        `Title trop long (${String(f.title.length)} car.), tronqué dans Google.`,
        f.title.length,
      ),
    );
  } else if (f.title.length < 15) {
    c.push(
      warn(
        'seo.title.length',
        'Balise title',
        `Title très court (${String(f.title.length)} car.).`,
        f.title.length,
      ),
    );
  } else {
    c.push(
      pass(
        'seo.title.ok',
        'Balise title',
        `Title présent (${String(f.title.length)} car.).`,
        f.title.length,
      ),
    );
  }

  // Meta description
  if (!f.metaDescription) {
    c.push(fail('seo.meta_desc.missing', 'Meta description', 'Aucune meta description.'));
  } else if (f.metaDescription.length > 160) {
    c.push(
      warn(
        'seo.meta_desc.length',
        'Meta description',
        `Trop longue (${String(f.metaDescription.length)} car.).`,
        f.metaDescription.length,
      ),
    );
  } else {
    c.push(
      pass(
        'seo.meta_desc.ok',
        'Meta description',
        `Présente (${String(f.metaDescription.length)} car.).`,
        f.metaDescription.length,
      ),
    );
  }

  // Canonical
  c.push(
    verdict(
      'seo.canonical',
      'URL canonique',
      f.canonical !== null,
      'Balise canonical présente.',
      'Pas de balise canonical (risque de contenu dupliqué).',
      'warn',
    ),
  );

  // Robots noindex
  if (f.robotsMeta && /noindex/i.test(f.robotsMeta)) {
    c.push(
      fail('seo.robots.noindex', 'Indexation', 'La page est en noindex : invisible pour Google.'),
    );
  } else {
    c.push(pass('seo.robots.ok', 'Indexation', 'Page indexable (pas de noindex).'));
  }

  // H1
  if (f.h1Count === 0) {
    c.push(fail('seo.h1.missing', 'Titre H1', 'Aucun H1 sur la page.'));
  } else if (f.h1Count > 1) {
    c.push(
      warn(
        'seo.h1.multiple',
        'Titre H1',
        `${String(f.h1Count)} balises H1 (une seule recommandée).`,
        f.h1Count,
      ),
    );
  } else {
    c.push(pass('seo.h1.ok', 'Titre H1', 'Un H1 unique.', 1));
  }

  // Headings hierarchy
  c.push(
    verdict(
      'seo.headings.hierarchy',
      'Hiérarchie des titres',
      !f.headingHierarchyBroken,
      'Hiérarchie Hn cohérente.',
      'Saut de niveau dans les titres (ex. H2 → H4).',
      'warn',
    ),
  );

  // Structured data
  if (f.jsonLdCount === 0) {
    c.push(warn('seo.jsonld.absent', 'Données structurées', 'Aucun JSON-LD (schema.org).'));
  } else {
    c.push(
      pass(
        'seo.jsonld.ok',
        'Données structurées',
        `${String(f.jsonLdCount)} bloc(s) JSON-LD${f.jsonLdTypes.length ? ` : ${f.jsonLdTypes.slice(0, 4).join(', ')}` : ''}.`,
        f.jsonLdCount,
      ),
    );
  }

  // OG image (social)
  c.push(
    verdict(
      'seo.og_image',
      'Partage social',
      Boolean(f.ogTags['og:image']),
      'Image Open Graph présente.',
      'Pas d’image Open Graph (partages sans aperçu).',
      'warn',
    ),
  );

  // HTTPS
  c.push(
    verdict('seo.https', 'HTTPS', f.isHttps, 'Site en HTTPS.', 'Site non sécurisé (HTTP).', 'fail'),
  );

  // hreflang sanity (info only)
  if (f.hreflangs.length > 0) {
    c.push(
      info(
        'seo.hreflang',
        'Hreflang',
        `${String(f.hreflangs.length)} balise(s) hreflang déclarée(s).`,
        f.hreflangs.length,
      ),
    );
  }

  return buildAxis('seo_technique', c);
}
