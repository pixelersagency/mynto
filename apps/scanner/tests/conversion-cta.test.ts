import { describe, expect, it } from 'vitest';

import { CTA_HINTS } from '../src/audit/collectors/conversion.js';

describe('CTA_HINTS regex', () => {
  it.each([
    'Je Réserve Mon Rendez-Vous',
    'Je réserve',
    'Réserver',
    'Réservez maintenant',
    'Réservation',
    'Prendre rendez-vous',
    'Mon rendez-vous',
    'Contactez-nous',
    'Nous contacter',
    'Demander un devis',
    'Devis gratuit',
    'En savoir plus',
    'Découvrir',
    "S'inscrire",
    'Sign up',
    'Get started',
    'Book a demo',
    'Book now',
    'Buy now',
    'Acheter',
    'Ajouter au panier',
    'Télécharger',
    'Appeler',
    'Call us',
  ])('matches CTA "%s"', (text) => {
    expect(CTA_HINTS.test(text)).toBe(true);
  });

  it.each([
    'Mentions légales',
    'CGV',
    'À propos',
    'Politique de confidentialité',
    'Connexion',
    'Mon compte',
    'Recherche',
  ])('does not match non-CTA "%s"', (text) => {
    expect(CTA_HINTS.test(text)).toBe(false);
  });
});
