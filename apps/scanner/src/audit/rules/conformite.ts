import type { AuditFacts, Finding, LegalRef } from '../types.js';

import { makeFinding, type RuleDefinition } from './types.js';

const LCEN_ART6: LegalRef = {
  standard: 'LCEN',
  label: "Loi pour la Confiance dans l'Économie Numérique — art. 6 III (mentions légales)",
  url: 'https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000042038977',
};
const RGPD_ART13: LegalRef = {
  standard: 'RGPD',
  label: 'RGPD — article 13 (information des personnes)',
  url: 'https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre3#Article13',
};
const CNIL_COOKIES: LegalRef = {
  standard: 'CNIL',
  label: 'CNIL — Cookies et traceurs (lignes directrices 2020)',
  url: 'https://www.cnil.fr/fr/cookies-et-traceurs',
};
const RGPD_ART37: LegalRef = {
  standard: 'RGPD',
  label: 'RGPD — article 37 (DPO)',
  url: 'https://www.cnil.fr/fr/reglement-europeen-protection-donnees/chapitre4#Article37',
};

const MENTIONS_LEGALES_MISSING: RuleDefinition = {
  code: 'conformite.mentions_legales.missing',
  axis: 'conformite',
  defaultSeverity: 'P0',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (facts.legal.mentionsLegalesUrl) return null;
    const ext = facts.legal.mentionsLegalesExternalUrl;
    return makeFinding(MENTIONS_LEGALES_MISSING, {
      title: ext
        ? 'Mentions légales non hébergées sur le site (lien vers un domaine externe)'
        : 'Page de mentions légales introuvable',
      evidence: ext ? { externalUrl: ext } : { triedDuringLegalProbe: true },
      legalRefs: [LCEN_ART6],
    });
  },
};

const PRIVACY_POLICY_MISSING: RuleDefinition = {
  code: 'conformite.privacy.missing',
  axis: 'conformite',
  defaultSeverity: 'P0',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    if (facts.legal.privacyUrl) return null;
    const ext = facts.legal.privacyExternalUrl;
    return makeFinding(PRIVACY_POLICY_MISSING, {
      title: ext
        ? 'Politique de confidentialité non hébergée sur le site (lien vers un domaine externe)'
        : 'Politique de confidentialité introuvable',
      evidence: ext ? { externalUrl: ext } : {},
      legalRefs: [RGPD_ART13],
    });
  },
};

const TRACKERS_WITHOUT_BANNER: RuleDefinition = {
  code: 'conformite.trackers.without_banner',
  axis: 'conformite',
  defaultSeverity: 'P0',
  defaultEffort: 'standard',
  evaluate: ({ facts }) => {
    const trackers = facts.legal.trackersDetected.filter(
      (t) => !['plausible', 'fathom', 'matomo'].includes(t),
    );
    if (trackers.length === 0) return null;
    if (facts.legal.cookiesBannerDetected) return null;
    return makeFinding(TRACKERS_WITHOUT_BANNER, {
      title: 'Trackers non essentiels détectés sans bannière cookies',
      evidence: { trackers, vendor: facts.legal.cookiesBannerVendor },
      legalRefs: [CNIL_COOKIES],
    });
  },
};

const DPO_NOT_MENTIONED: RuleDefinition = {
  code: 'conformite.dpo.not_mentioned',
  axis: 'conformite',
  defaultSeverity: 'P3',
  defaultEffort: 'quick_win',
  evaluate: ({ facts }) => {
    if (!facts.legal.privacyUrl) return null; // only flag if a policy exists
    // Only assert when the policy page was actually inspected: `null` means
    // it could not be fetched (external host, unreachable) -> do not flag.
    if (facts.legal.dpoMentioned !== false) return null;
    return makeFinding(DPO_NOT_MENTIONED, {
      title: 'DPO non mentionné dans la politique de confidentialité',
      evidence: { privacyUrl: facts.legal.privacyUrl },
      legalRefs: [RGPD_ART37],
    });
  },
};

export const CONFORMITE_RULES: RuleDefinition[] = [
  MENTIONS_LEGALES_MISSING,
  PRIVACY_POLICY_MISSING,
  TRACKERS_WITHOUT_BANNER,
  DPO_NOT_MENTIONED,
];

export function applyConformiteRules(ctx: { facts: AuditFacts; origin: string }): Finding[] {
  const out: Finding[] = [];
  for (const rule of CONFORMITE_RULES) {
    const res = rule.evaluate(ctx);
    if (!res) continue;
    if (Array.isArray(res)) out.push(...res);
    else out.push(res);
  }
  return out;
}
