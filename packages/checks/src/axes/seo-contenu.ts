import { buildAxis, fail, info, pass, verdict, warn } from '../score.js';
import type { AxisResult, CheckResult, DomFacts } from '../types.js';

export function evaluateSeoContenu(f: DomFacts): AxisResult {
  const c: CheckResult[] = [];

  // Word count
  if (f.wordCount < 150) {
    c.push(
      fail(
        'content.thin',
        'Volume de contenu',
        `Contenu très maigre (${String(f.wordCount)} mots).`,
        f.wordCount,
      ),
    );
  } else if (f.wordCount < 300) {
    c.push(
      warn(
        'content.short',
        'Volume de contenu',
        `Contenu court (${String(f.wordCount)} mots).`,
        f.wordCount,
      ),
    );
  } else {
    c.push(pass('content.ok', 'Volume de contenu', `${String(f.wordCount)} mots.`, f.wordCount));
  }

  // Paragraph structure
  if (f.paragraphCount === 0 && f.wordCount > 200) {
    c.push(
      warn(
        'content.no_paragraphs',
        'Structure du texte',
        'Beaucoup de texte sans balises <p> (lisibilité machine faible).',
      ),
    );
  } else {
    c.push(
      pass(
        'content.paragraphs',
        'Structure du texte',
        `${String(f.paragraphCount)} paragraphe(s).`,
        f.paragraphCount,
      ),
    );
  }

  // Blog / editorial
  c.push(
    verdict(
      'content.blog',
      'Section blog / actualités',
      f.hasBlogLink,
      'Lien vers un blog ou des actualités détecté.',
      'Aucun blog visible : peu de contenu frais pour le SEO long terme.',
      'warn',
    ),
  );

  // Heading text richness (proxy for keyword structure)
  const namedHeadings = f.headingOutline.filter((h) => h.text.length > 0).length;
  if (namedHeadings <= 1) {
    c.push(
      warn(
        'content.headings_thin',
        'Titres de section',
        'Très peu de titres de section pour structurer le contenu.',
        namedHeadings,
      ),
    );
  } else {
    c.push(
      pass(
        'content.headings',
        'Titres de section',
        `${String(namedHeadings)} titres de section.`,
        namedHeadings,
      ),
    );
  }

  // Language consistency vs declared lang
  if (f.lang && /^fr/i.test(f.lang) && f.wordCount > 50 && !f.textLangSampleFrench) {
    c.push(
      warn(
        'content.lang_mismatch',
        'Langue',
        'Langue déclarée "fr" mais le texte ne semble pas français.',
      ),
    );
  } else if (f.lang) {
    c.push(info('content.lang', 'Langue', `Langue déclarée : ${f.lang}.`));
  }

  return buildAxis('seo_contenu', c);
}
