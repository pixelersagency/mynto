import { buildAxis, fail, pass, verdict, warn } from '../score.js';
import type { AxisResult, CheckResult, DomFacts } from '../types.js';

export function evaluateConversion(f: DomFacts): AxisResult {
  const c: CheckResult[] = [];

  // CTAs
  if (f.ctaButtons === 0) {
    c.push(fail('conv.cta', 'Appels à l’action', 'Aucun bouton / CTA détecté sur la page.'));
  } else if (f.ctaButtons < 2) {
    c.push(
      warn(
        'conv.cta',
        'Appels à l’action',
        'Un seul CTA détecté : peu d’incitation à agir.',
        f.ctaButtons,
      ),
    );
  } else {
    c.push(
      pass('conv.cta', 'Appels à l’action', `${String(f.ctaButtons)} CTA détectés.`, f.ctaButtons),
    );
  }

  // Contact reachability
  const contactSignals = [
    f.hasContactLink,
    f.hasPhoneLink,
    f.hasMailtoLink,
    f.formsCount > 0,
  ].filter(Boolean).length;
  if (contactSignals === 0) {
    c.push(
      fail(
        'conv.contact',
        'Moyen de contact',
        'Aucun canal de contact visible (lien, téléphone, email, formulaire).',
      ),
    );
  } else {
    const parts: string[] = [];
    if (f.hasPhoneLink) parts.push('téléphone');
    if (f.hasMailtoLink) parts.push('email');
    if (f.formsCount > 0) parts.push('formulaire');
    if (f.hasContactLink) parts.push('page contact');
    c.push(pass('conv.contact', 'Moyen de contact', `Contact possible : ${parts.join(', ')}.`));
  }

  // Social proof
  c.push(
    verdict(
      'conv.testimonials',
      'Preuve sociale',
      f.testimonialHints > 0,
      `${String(f.testimonialHints)} indice(s) de témoignages.`,
      'Aucun témoignage / avis visible.',
      'warn',
      f.testimonialHints,
    ),
  );

  // Trust logos
  if (f.trustLogoHints > 0) {
    c.push(
      pass(
        'conv.trust',
        'Logos de confiance',
        `${String(f.trustLogoHints)} logo(s) clients/partenaires détecté(s).`,
        f.trustLogoHints,
      ),
    );
  } else {
    c.push(warn('conv.trust', 'Logos de confiance', 'Aucun logo client/partenaire visible.'));
  }

  // Form presence (lead capture)
  c.push(
    verdict(
      'conv.form',
      'Capture de lead',
      f.formsCount > 0,
      `${String(f.formsCount)} formulaire(s).`,
      'Aucun formulaire de capture.',
      'warn',
      f.formsCount,
    ),
  );

  return buildAxis('conversion', c);
}
