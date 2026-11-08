import { buildAxis, fail, info, pass, verdict, warn } from '../score.js';
import type { AxisResult, CheckResult, DomFacts } from '../types.js';

export function evaluateConformite(f: DomFacts): AxisResult {
  const c: CheckResult[] = [];

  // Mentions légales (LCEN obligatoire)
  c.push(
    verdict(
      'legal.mentions',
      'Mentions légales',
      f.legalLinks.mentions,
      'Lien mentions légales détecté.',
      'Aucun lien mentions légales (obligatoire, LCEN).',
      'fail',
    ),
  );

  // Privacy / RGPD
  c.push(
    verdict(
      'legal.privacy',
      'Politique de confidentialité',
      f.legalLinks.privacy,
      'Politique de confidentialité détectée.',
      'Aucune politique de confidentialité (RGPD).',
      'fail',
    ),
  );

  // CGV/CGU
  c.push(
    verdict(
      'legal.cgv',
      'CGV / CGU',
      f.legalLinks.cgv,
      'CGV/CGU détectées.',
      'Aucune CGV/CGU visible.',
      'warn',
    ),
  );

  // Trackers vs consent
  if (f.trackers.length > 0) {
    if (f.cookieBannerVendor) {
      c.push(
        pass(
          'legal.consent',
          'Consentement cookies',
          `Bannière ${f.cookieBannerVendor} détectée avec ${String(f.trackers.length)} traceur(s).`,
        ),
      );
    } else if (f.legalLinks.cookies) {
      c.push(
        warn(
          'legal.consent',
          'Consentement cookies',
          `${String(f.trackers.length)} traceur(s) détecté(s), bannière de consentement non identifiée.`,
          f.trackers.length,
        ),
      );
    } else {
      c.push(
        fail(
          'legal.consent',
          'Consentement cookies',
          `${String(f.trackers.length)} traceur(s) (${f.trackers.join(', ')}) sans bannière de consentement (CNIL).`,
          f.trackers.length,
        ),
      );
    }
    c.push(info('legal.trackers', 'Traceurs détectés', f.trackers.join(', '), f.trackers.length));
  } else {
    c.push(pass('legal.consent', 'Consentement cookies', 'Aucun traceur tiers détecté.'));
  }

  return buildAxis('conformite', c);
}
