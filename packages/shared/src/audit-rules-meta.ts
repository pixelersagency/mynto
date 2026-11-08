/**
 * Static metadata for every deterministic rule the full-audit pipeline can
 * emit. Source of truth for "coverage" rendering on the public report — the
 * web app derives "passed" rules by diff'ing this list against the findings
 * actually emitted on a given audit.
 *
 * Keep this file in sync with `apps/scanner/src/audit/rules/*.ts`. Whenever
 * a new rule is added there, append its metadata here. A unit test could
 * later enforce this — for now it's a manual checklist.
 */

import type { AuditAxis, AuditEffort, AuditSeverity } from './schemas/audit-full.js';

export type AuditCollector = 'lighthouse' | 'axe';

export interface AuditRuleMeta {
  code: string;
  axis: AuditAxis;
  defaultSeverity: AuditSeverity;
  defaultEffort: AuditEffort;
  /** Short label shown when the rule passes (e.g. "Sitemap déclaré"). */
  passedLabel: string;
  /** What the rule looks for. Shown in the coverage list when expanded. */
  description: string;
  /** True when the rule only fires if a heavy collector ran (Lighthouse/axe). */
  requiresHeavyCollector?: boolean;
  /**
   * Specific collector required for this rule. When set, the rule is shown
   * as "skipped" if that collector did not run (instead of relying on the
   * generic heavyRan flag, which over-reports validations).
   */
  requiredCollector?: AuditCollector;
}

export const AUDIT_RULES_META: AuditRuleMeta[] = [
  // SEO Technique
  {
    code: 'seo.https.missing',
    axis: 'seo_technique',
    defaultSeverity: 'P0',
    defaultEffort: 'standard',
    passedLabel: 'Site servi en HTTPS',
    description: 'Le site doit être servi en HTTPS (pas de mixed content).',
  },
  {
    code: 'seo.fake_one_page',
    axis: 'seo_technique',
    defaultSeverity: 'P0',
    defaultEffort: 'important',
    passedLabel: 'Pages internes uniques',
    description: 'Plusieurs URLs renvoient des contenus distincts (pas de fake one-page).',
  },
  {
    code: 'seo.robots.disallow_all',
    axis: 'seo_technique',
    defaultSeverity: 'P0',
    defaultEffort: 'quick_win',
    passedLabel: "robots.txt n'interdit pas le crawl",
    description: "Le robots.txt n'a pas de directive Disallow: / globale.",
  },
  {
    code: 'seo.sitemap.missing',
    axis: 'seo_technique',
    defaultSeverity: 'P0',
    defaultEffort: 'quick_win',
    passedLabel: 'sitemap.xml trouvé',
    description: 'Un sitemap.xml est accessible et expose les URLs du site.',
  },
  {
    code: 'seo.sitemap.not_declared_in_robots',
    axis: 'seo_technique',
    defaultSeverity: 'P2',
    defaultEffort: 'quick_win',
    passedLabel: 'Sitemap déclaré dans robots.txt',
    description: 'Le robots.txt référence explicitement le sitemap.',
  },
  {
    code: 'seo.title.missing',
    axis: 'seo_technique',
    defaultSeverity: 'P0',
    defaultEffort: 'quick_win',
    passedLabel: 'Balise <title> présente',
    description: 'La page expose une balise <title> non vide.',
  },
  {
    code: 'seo.title.too_long',
    axis: 'seo_technique',
    defaultSeverity: 'P2',
    defaultEffort: 'quick_win',
    passedLabel: 'Title bien dimensionné',
    description: 'Title <= 60 caractères pour ne pas être tronqué sur SERP.',
  },
  {
    code: 'seo.meta_description.missing',
    axis: 'seo_technique',
    defaultSeverity: 'P1',
    defaultEffort: 'quick_win',
    passedLabel: 'Meta description présente',
    description: 'Meta description non vide pour contrôler le snippet SERP.',
  },
  {
    code: 'seo.meta_description.too_long',
    axis: 'seo_technique',
    defaultSeverity: 'P2',
    defaultEffort: 'quick_win',
    passedLabel: 'Meta description bien dimensionnée',
    description: 'Meta description <= 160 caractères.',
  },
  {
    code: 'seo.og_image.missing',
    axis: 'seo_technique',
    defaultSeverity: 'P1',
    defaultEffort: 'quick_win',
    passedLabel: 'og:image définie',
    description: 'Image Open Graph présente pour les partages sociaux.',
  },
  {
    code: 'seo.twitter_card.summary_small',
    axis: 'seo_technique',
    defaultSeverity: 'P2',
    defaultEffort: 'quick_win',
    passedLabel: 'Twitter Card optimisée',
    description: 'twitter:card en summary_large_image (visuel plein écran).',
  },
  {
    code: 'seo.json_ld.absent',
    axis: 'seo_technique',
    defaultSeverity: 'P1',
    defaultEffort: 'standard',
    passedLabel: 'Données structurées présentes',
    description: 'Au moins un bloc JSON-LD (Schema.org) détecté.',
  },
  {
    code: 'seo.canonical.points_to_home',
    axis: 'seo_technique',
    defaultSeverity: 'P0',
    defaultEffort: 'quick_win',
    passedLabel: 'Canonical cohérent',
    description: 'La balise canonical ne pointe pas systématiquement vers la home.',
  },
  {
    code: 'seo.h1.missing_or_multiple',
    axis: 'seo_technique',
    defaultSeverity: 'P1',
    defaultEffort: 'standard',
    passedLabel: 'Un seul H1 par page',
    description: 'Exactement une balise H1, structurée et descriptive.',
  },
  {
    code: 'seo.headings.hierarchy_broken',
    axis: 'seo_technique',
    defaultSeverity: 'P2',
    defaultEffort: 'standard',
    passedLabel: 'Hiérarchie des titres respectée',
    description: 'Pas de saut de niveau (H2 puis H4 sans H3).',
  },
  {
    code: 'seo.hreflang.missing',
    axis: 'seo_technique',
    defaultSeverity: 'P2',
    defaultEffort: 'standard',
    passedLabel: 'hreflang présent (si multilingue)',
    description: "Hreflang déclaré si l'URL indique une langue (/fr/, /en/...).",
  },
  {
    code: 'seo.robots.blocks_ai_bots',
    axis: 'seo_technique',
    defaultSeverity: 'P2',
    defaultEffort: 'quick_win',
    passedLabel: 'Bots IA autorisés',
    description: "robots.txt n'interdit pas GPTBot/ClaudeBot/Perplexity (acquisition AI search).",
  },

  // SEO Contenu
  {
    code: 'seo_contenu.blog.absent',
    axis: 'seo_contenu',
    defaultSeverity: 'P1',
    defaultEffort: 'important',
    passedLabel: 'Section blog ou contenu éditorial présente',
    description: 'Un blog/section ressources est indexable (longue traîne SEO).',
  },
  {
    code: 'seo_contenu.blog.external_jus_lost',
    axis: 'seo_contenu',
    defaultSeverity: 'P2',
    defaultEffort: 'important',
    passedLabel: 'Blog hébergé sur le domaine principal',
    description:
      "Le contenu éditorial pointe vers un domaine externe (sous-domaine ou site annexe) : l'autorité SEO accumulée nourrit ce domaine au lieu du domaine principal.",
  },
  {
    code: 'seo_contenu.home.thin',
    axis: 'seo_contenu',
    defaultSeverity: 'P2',
    defaultEffort: 'standard',
    passedLabel: 'Contenu home suffisant',
    description: "La page d'accueil contient au moins 250 mots.",
  },
  {
    code: 'seo_contenu.readability.hard',
    axis: 'seo_contenu',
    defaultSeverity: 'P3',
    defaultEffort: 'standard',
    passedLabel: 'Lisibilité correcte',
    description: 'Score Flesch FR >= 50 (texte accessible à un large public).',
  },

  // Performance
  {
    code: 'perf.ttfb.slow',
    axis: 'performance',
    defaultSeverity: 'P1',
    defaultEffort: 'standard',
    passedLabel: 'TTFB rapide',
    description: 'Time To First Byte < 800 ms.',
  },
  {
    code: 'perf.html.heavy',
    axis: 'performance',
    defaultSeverity: 'P2',
    defaultEffort: 'standard',
    passedLabel: 'HTML raisonnable',
    description: 'Page HTML < 250 KB.',
  },
  {
    code: 'perf.images.not_lazy',
    axis: 'performance',
    defaultSeverity: 'P2',
    defaultEffort: 'quick_win',
    passedLabel: 'Lazy-loading utilisé',
    description: 'Au moins 50% des images en lazy-loading (si >= 10 images).',
  },
  {
    code: 'perf.images.missing_dimensions',
    axis: 'performance',
    defaultSeverity: 'P2',
    defaultEffort: 'quick_win',
    passedLabel: 'Images dimensionnées (anti-CLS)',
    description: '70%+ des images ont width + height (évite Cumulative Layout Shift).',
  },
  {
    code: 'perf.lighthouse.low',
    axis: 'performance',
    defaultSeverity: 'P1',
    defaultEffort: 'important',
    passedLabel: 'Score Lighthouse performance correct',
    description: 'Score Lighthouse performance >= 70/100.',
    requiresHeavyCollector: true,
    requiredCollector: 'lighthouse',
  },
  {
    code: 'perf.lcp.slow',
    axis: 'performance',
    defaultSeverity: 'P1',
    defaultEffort: 'important',
    passedLabel: 'LCP rapide',
    description: 'Largest Contentful Paint < 2500 ms (seuil Google).',
    requiresHeavyCollector: true,
    requiredCollector: 'lighthouse',
  },
  {
    code: 'perf.cls.high',
    axis: 'performance',
    defaultSeverity: 'P1',
    defaultEffort: 'standard',
    passedLabel: 'CLS stable',
    description: 'Cumulative Layout Shift < 0.1.',
    requiresHeavyCollector: true,
    requiredCollector: 'lighthouse',
  },
  {
    code: 'perf.tbt.high',
    axis: 'performance',
    defaultSeverity: 'P2',
    defaultEffort: 'important',
    passedLabel: 'TBT raisonnable',
    description: 'Total Blocking Time < 300 ms.',
    requiresHeavyCollector: true,
    requiredCollector: 'lighthouse',
  },
  {
    code: 'perf.byte_weight.heavy',
    axis: 'performance',
    defaultSeverity: 'P2',
    defaultEffort: 'standard',
    passedLabel: 'Poids total raisonnable',
    description: 'Total chargé < 3 MB.',
    requiresHeavyCollector: true,
    requiredCollector: 'lighthouse',
  },

  // Accessibilité
  {
    code: 'a11y.viewport.blocks_zoom',
    axis: 'accessibilite',
    defaultSeverity: 'P0',
    defaultEffort: 'quick_win',
    passedLabel: 'Viewport autorise le zoom',
    description: 'Pas de user-scalable=no ni maximum-scale=1 (WCAG 1.4.4 / RGAA 10.4 / EAA).',
  },
  {
    code: 'a11y.html_lang.missing',
    axis: 'accessibilite',
    defaultSeverity: 'P1',
    defaultEffort: 'quick_win',
    passedLabel: 'Attribut lang sur <html>',
    description: 'Langue principale déclarée sur <html lang="...">.',
  },
  {
    code: 'a11y.images.missing_alt',
    axis: 'accessibilite',
    defaultSeverity: 'P1',
    defaultEffort: 'standard',
    passedLabel: 'Images avec alt text',
    description: '90%+ des images ont un attribut alt (WCAG 1.1.1 / RGAA 1.1).',
  },
  {
    code: 'a11y.skip_link.missing',
    axis: 'accessibilite',
    defaultSeverity: 'P2',
    defaultEffort: 'quick_win',
    passedLabel: "Lien d'évitement présent",
    description: 'Lien "Aller au contenu" pour navigation clavier.',
  },
  {
    code: 'a11y.axe.critical',
    axis: 'accessibilite',
    defaultSeverity: 'P0',
    defaultEffort: 'standard',
    passedLabel: 'Aucune violation WCAG critique (axe-core)',
    description: "axe-core ne détecte aucune violation d'impact critical.",
    requiresHeavyCollector: true,
    requiredCollector: 'axe',
  },
  {
    code: 'a11y.axe.serious',
    axis: 'accessibilite',
    defaultSeverity: 'P1',
    defaultEffort: 'standard',
    passedLabel: 'Aucune violation WCAG sérieuse (axe-core)',
    description: "axe-core ne détecte aucune violation d'impact serious.",
    requiresHeavyCollector: true,
    requiredCollector: 'axe',
  },
  {
    code: 'a11y.lighthouse.low',
    axis: 'accessibilite',
    defaultSeverity: 'P1',
    defaultEffort: 'standard',
    passedLabel: 'Score Lighthouse accessibilité correct',
    description: 'Score Lighthouse accessibility >= 90/100.',
    requiresHeavyCollector: true,
    requiredCollector: 'lighthouse',
  },

  // Conformité
  {
    code: 'conformite.mentions_legales.missing',
    axis: 'conformite',
    defaultSeverity: 'P0',
    defaultEffort: 'standard',
    passedLabel: 'Mentions légales présentes',
    description: 'Page de mentions légales accessible (LCEN article 6 III).',
  },
  {
    code: 'conformite.privacy.missing',
    axis: 'conformite',
    defaultSeverity: 'P0',
    defaultEffort: 'standard',
    passedLabel: 'Politique de confidentialité présente',
    description: 'Politique de confidentialité accessible (RGPD article 13).',
  },
  {
    code: 'conformite.trackers.without_banner',
    axis: 'conformite',
    defaultSeverity: 'P0',
    defaultEffort: 'standard',
    passedLabel: 'Bannière cookies cohérente avec trackers',
    description: 'Si trackers non essentiels, bannière de consentement (CNIL).',
  },
  {
    code: 'conformite.dpo.not_mentioned',
    axis: 'conformite',
    defaultSeverity: 'P3',
    defaultEffort: 'quick_win',
    passedLabel: 'DPO mentionné',
    description: 'Coordonnées DPO dans la politique (RGPD article 37).',
  },

  // Conversion
  {
    code: 'conversion.pricing.anchor_only',
    axis: 'conversion',
    defaultSeverity: 'P1',
    defaultEffort: 'standard',
    passedLabel: 'Page /pricing dédiée',
    description: "Tarifs accessibles via une URL propre (pas qu'une ancre).",
  },
  {
    code: 'conversion.testimonials.thin',
    axis: 'conversion',
    defaultSeverity: 'P2',
    defaultEffort: 'standard',
    passedLabel: 'Témoignages complets',
    description: 'Témoignages avec nom + photo, pas anonymes.',
  },
  {
    code: 'conversion.cta.not_above_fold',
    axis: 'conversion',
    defaultSeverity: 'P1',
    defaultEffort: 'standard',
    passedLabel: 'CTA visible above the fold',
    description: 'Au moins un call-to-action explicite dans le premier viewport.',
  },
  {
    code: 'conversion.contact.thin',
    axis: 'conversion',
    defaultSeverity: 'P2',
    defaultEffort: 'quick_win',
    passedLabel: 'Canal de contact direct',
    description: 'Téléphone, formulaire, WhatsApp ou équivalent disponible.',
  },
  {
    code: 'conversion.cta.low_contrast_visual',
    axis: 'conversion',
    defaultSeverity: 'P2',
    defaultEffort: 'quick_win',
    passedLabel: 'CTA principal contrasté',
    description:
      'Le CTA principal ressort visuellement de son fond (analyse vision LLM sur capture rendue).',
  },
  {
    code: 'conversion.copy.generic',
    axis: 'conversion',
    defaultSeverity: 'P1',
    defaultEffort: 'important',
    passedLabel: 'Proposition de valeur claire',
    description:
      'Le copy de la home communique clairement ce que le site fait et pour qui (analyse vision LLM).',
  },
  {
    code: 'conversion.copy.no_proof',
    axis: 'conversion',
    defaultSeverity: 'P2',
    defaultEffort: 'standard',
    passedLabel: 'Copywriting étayé',
    description:
      "Le copy s'appuie sur des preuves chiffrées / cas concrets plutôt que sur des verbes faibles ou des affirmations génériques (analyse vision LLM).",
  },

  // UI
  {
    code: 'ui.inline_styles.heavy',
    axis: 'ui',
    defaultSeverity: 'P3',
    defaultEffort: 'standard',
    passedLabel: 'Styles inline raisonnables',
    description: 'Total styles inline < 20 KB (maintenabilité + perf).',
  },
  {
    code: 'ui.fonts.too_many',
    axis: 'ui',
    defaultSeverity: 'P3',
    defaultEffort: 'standard',
    passedLabel: 'Nombre de polices raisonnable',
    description: 'Moins de 4 familles de polices différentes.',
  },
  {
    code: 'ui.hero.confused',
    axis: 'ui',
    defaultSeverity: 'P1',
    defaultEffort: 'important',
    passedLabel: 'Hero clair',
    description:
      "Le premier écran communique clairement qui est l'entreprise et quoi elle fait pour qui (analyse vision LLM).",
  },
  {
    code: 'ui.visual_hierarchy.weak',
    axis: 'ui',
    defaultSeverity: 'P2',
    defaultEffort: 'important',
    passedLabel: 'Hiérarchie visuelle nette',
    description:
      'Progression lisible headline → sous-titre → CTA → preuve (note vision LLM ≥ 6/10).',
  },
  {
    code: 'ui.design.dated_for_sector',
    axis: 'ui',
    defaultSeverity: 'P1',
    defaultEffort: 'important',
    passedLabel: 'Design au niveau du secteur',
    description:
      'La qualité du design est au moins équivalente au standard actuel du secteur (analyse vision LLM, note ≥ 5/10).',
  },
  {
    code: 'ui.brand.inconsistent',
    axis: 'ui',
    defaultSeverity: 'P2',
    defaultEffort: 'important',
    passedLabel: 'Identité visuelle cohérente',
    description:
      'Polices, couleurs et espacements forment une identité reconnaissable (analyse vision LLM, note ≥ 6/10).',
  },

  // UX
  {
    code: 'ux.viewport.missing',
    axis: 'ux',
    defaultSeverity: 'P0',
    defaultEffort: 'quick_win',
    passedLabel: 'Viewport mobile configuré',
    description: 'meta viewport avec width=device-width.',
  },
  {
    code: 'ux.nav.empty',
    axis: 'ux',
    defaultSeverity: 'P2',
    defaultEffort: 'standard',
    passedLabel: 'Navigation principale présente',
    description: 'Au moins un élément <nav> avec des liens.',
  },
  {
    code: 'ux.navigation.unclear',
    axis: 'ux',
    defaultSeverity: 'P2',
    defaultEffort: 'standard',
    passedLabel: 'Navigation lisible',
    description:
      'Les labels de nav sont descriptifs plutôt que mystery-meat (analyse vision LLM, note ≥ 6/10).',
  },
  {
    code: 'ux.friction.detected',
    axis: 'ux',
    defaultSeverity: 'P2',
    defaultEffort: 'standard',
    passedLabel: 'Aucune friction UX visible',
    description:
      'Le scan visuel ne détecte pas de friction concrète sur la home (modal cookie bloquant, menu mobile illisible, etc.).',
  },
];

export function getRuleMeta(code: string): AuditRuleMeta | undefined {
  return AUDIT_RULES_META.find((r) => r.code === code);
}

export function getRulesByAxis(axis: AuditAxis): AuditRuleMeta[] {
  return AUDIT_RULES_META.filter((r) => r.axis === axis);
}
