import {
  AuditFullFindingSchema,
  AuditFullResultSchema,
  type AuditFullFinding,
  type AuditFullResult,
} from '@mynto/shared';

import { buildReportData, type BuildAgency } from './build-data.js';
import type { ReportDataV1 } from './contract.js';
import type { TemplateBundle } from './engine.js';
import { resolveSettings } from './manifest.js';

/**
 * Example audit used by the CLI preview, the dashboard live preview, the
 * MCP preview without an audit id, the tests and docs/templates/example-data.json.
 * Fictional site, realistic content.
 */

const CREATED = '2026-11-02T09:14:00.000Z';

const AI_CHECKS = [
  ['robots_txt', 'discoverability', 'pass', 'robots.txt présent, 4 directives.', 3],
  ['sitemap', 'discoverability', 'pass', 'sitemap.xml trouvé, 38 URLs.', 3],
  ['link_headers', 'discoverability', 'fail', 'Aucun en-tête Link utile aux agents.', 2],
  ['dns_aid', 'discoverability', 'fail', 'Aucun enregistrement _agents.', 1],
  [
    'markdown_negotiation',
    'content_accessibility',
    'fail',
    'Le site renvoie du HTML quand on demande du Markdown.',
    3,
  ],
  ['llms_txt', 'content_accessibility', 'fail', '/llms.txt répond 404.', 2],
  ['no_js_content', 'content_accessibility', 'pass', '412 mots lisibles sans JavaScript.', 3],
  ['ai_bot_rules', 'bot_access', 'fail', 'robots.txt ne nomme aucun robot d’IA.', 3],
  ['content_signals', 'bot_access', 'fail', 'Pas de ligne Content-Signal dans robots.txt.', 2],
  ['web_bot_auth', 'bot_access', 'neutral', 'Pas d’annuaire Web Bot Auth (facultatif).', 0],
  ['ai_bot_live_access', 'bot_access', 'pass', 'GPTBot et ClaudeBot accèdent bien à la page.', 3],
] as const;

/** Fix hints of the failed example checks, worded like the scanner's. */
const AI_FIX: Partial<Record<(typeof AI_CHECKS)[number][0], string>> = {
  link_headers:
    'Ajoute un en-tête HTTP Link à tes pages publiques pour indiquer aux agents où trouver leurs versions lisibles par une machine.',
  dns_aid:
    'Ajoute des enregistrements DNS sous _agents.ton-domaine : un SVCB _index._agents qui pointe vers la liste de tes ressources pour agents.',
  markdown_negotiation:
    'Propose une version Markdown de tes pages publiques : renvoie du text/markdown quand la requête contient Accept: text/markdown, et rends la même page disponible avec le suffixe .md.',
  llms_txt:
    'Publie un fichier /llms.txt en Markdown : un titre H1 avec le nom du site, un paragraphe qui dit ce que tu fais et pour qui, puis des liens vers tes pages clés.',
  ai_bot_rules:
    'Dans robots.txt, ajoute un bloc pour chaque robot d’IA que tu veux autoriser ou bloquer, par exemple User-agent: GPTBot puis Allow: /.',
  content_signals:
    'Ajoute une ligne Content-Signal dans robots.txt pour dire ce que tu autorises, par exemple Content-Signal: ai-train=no, search=yes, ai-input=yes.',
};

export const EXAMPLE_AUDIT: AuditFullResult = AuditFullResultSchema.parse({
  slug: 'ex4mpleSlug01',
  url: 'https://www.boulangerie-martin.fr/',
  status: 'completed',
  scanned_at: CREATED,
  stack: 'WordPress',
  stack_confidence: 0.92,
  sector: 'artisanat alimentaire',
  sector_confidence: 0.8,
  main_kpi: 'Commandes de gâteaux en ligne',
  secondary_kpi: 'Appels en boutique',
  global_score: 5.8,
  global_band: 'fair',
  axis_scores: {
    seo_technique: { score: 6.4, band: 'fair', weight: 1.2 },
    seo_contenu: { score: 5.1, band: 'fair', weight: 0.8 },
    performance: { score: 3.9, band: 'poor', weight: 1.1 },
    accessibilite: { score: 4.6, band: 'poor', weight: 1 },
    conformite: { score: 3.2, band: 'critical', weight: 1 },
    conversion: { score: 6.8, band: 'fair', weight: 1.2 },
    ux: { score: 8.1, band: 'good', weight: 0.8 },
    ui: { score: 7.4, band: 'good', weight: 0.6 },
  },
  exec_summary:
    'Le site présente bien la boutique mais il perd des commandes. Les pages mettent plus de 4 secondes à s’afficher sur mobile, la politique de confidentialité manque alors que trois traceurs se chargent sans consentement, et le bouton de commande n’apparaît qu’en bas de page. Trois chantiers courts suffisent à corriger l’essentiel.',
  top3_priorities: [
    {
      title: 'Mettre le site en conformité RGPD',
      reason:
        'Trois traceurs publicitaires se chargent avant tout consentement et la politique de confidentialité est absente. C’est le risque le plus direct (CNIL) et le plus simple à corriger.',
      findingIds: ['conformite.trackers.without_banner:a1', 'conformite.privacy.missing:a2'],
      expectedOutcome: 'Risque de sanction écarté, confiance des clients renforcée.',
    },
    {
      title: 'Accélérer l’affichage sur mobile',
      reason:
        'Le premier affichage prend 4,6 s. Les photos des gâteaux pèsent 6 Mo et ne sont pas différées. Sur mobile, un visiteur sur deux part avant.',
      findingIds: ['perf.lcp.slow:b1', 'perf.images.not_lazy:b2'],
      expectedOutcome: 'Affichage sous 2,5 s, moins d’abandons sur mobile.',
    },
    {
      title: 'Rendre la commande visible tout de suite',
      reason:
        'Le bouton « Commander un gâteau » est sous la ligne de flottaison. Les visiteurs qui viennent pour commander doivent le chercher.',
      findingIds: ['conversion.cta.not_above_fold:c1'],
      expectedOutcome: 'Plus de commandes depuis la page d’accueil.',
    },
  ],
  quick_wins: [
    'Ajouter la politique de confidentialité au pied de page.',
    'Compresser les 6 photos de la page d’accueil en WebP.',
    'Remonter le bouton de commande dans le premier écran.',
    'Renseigner un texte alternatif sur les 9 images produits.',
  ],
  killer_findings: [],
  estimated_impact_narrative:
    'Corriger la vitesse et la place du bouton peut faire gagner 10 à 20 % de commandes en ligne sur mobile.',
  llm_provider: 'anthropic',
  llm_model: 'claude-sonnet-5',
  llm_duration_ms: 18000,
  created_at: CREATED,
  expires_at: '2027-01-01T09:14:00.000Z',
  facts: {
    lighthouse: { fetched: true },
    axe: { fetched: true },
    internalPagesCrawled: [
      { url: 'https://www.boulangerie-martin.fr/gateaux', status: 200, bytes: 120000 },
      { url: 'https://www.boulangerie-martin.fr/contact', status: 200, bytes: 60000 },
      { url: 'https://www.boulangerie-martin.fr/la-boutique', status: 200, bytes: 80000 },
    ],
  },
  hero_screenshot_url: null,
  cost_estimate: {
    totalMinutes: 2160,
    totalDays: 4.5,
    dailyRateEur: 600,
    billableHoursPerDay: 8,
    amountEurLow: 2430,
    amountEurHigh: 2970,
    items: [
      {
        findingId: 'conformite.privacy.missing:a2',
        ruleCode: 'conformite.privacy.missing',
        title: 'Politique de confidentialité absente',
        occurrences: 1,
        minutes: 120,
      },
      {
        findingId: 'perf.lcp.slow:b1',
        ruleCode: 'perf.lcp.slow',
        title: 'Affichage principal lent',
        occurrences: 1,
        minutes: 480,
      },
    ],
    uncostedFindingIds: [],
    qualitativeExcludedCount: 0,
    disclaimer: 'Estimation indicative fondée sur des temps moyens par correction.',
  },
  remediation: {
    mode: 'correction_or_redesign',
    closedCms: false,
    detectedStack: 'WordPress',
    datedTech: false,
    redesignReasons: [],
    showQuickFixButton: true,
  },
  modules: null,
  ai_readiness: {
    version: 1,
    status: 'completed',
    scanned_at: CREATED,
    score: 43,
    level: 1,
    level_name: 'Présence de base',
    max_level: 3,
    site_type: 'vitrine',
    site_type_auto: true,
    site_type_signals: [],
    included_in_global_score: false,
    error: null,
    checks: AI_CHECKS.map(([id, category, status, message, weight]) => ({
      id,
      category,
      status,
      message,
      evidence: [],
      specUrls: [],
      weight,
      ...(status === 'fail' && AI_FIX[id] !== undefined ? { fixPrompt: AI_FIX[id] } : {}),
    })),
  },
  ai_score: 43,
});

function finding(
  id: string,
  rule: string,
  axis: AuditFullFinding['axis'],
  severity: AuditFullFinding['severity'],
  title: string,
  constat: string,
  impact: string,
  reco: string,
  extra: Partial<AuditFullFinding> = {},
): AuditFullFinding {
  return AuditFullFindingSchema.parse({
    id,
    rule_code: rule,
    axis,
    severity,
    effort: 'standard',
    title,
    evidence: {},
    affected_urls: ['https://www.boulangerie-martin.fr/'],
    legal_refs: [],
    narrative_constat: constat,
    narrative_impact_business: impact,
    narrative_recommandation: reco,
    narrative_code_snippet: null,
    created_at: CREATED,
    ...extra,
  });
}

export const EXAMPLE_FINDINGS: AuditFullFinding[] = [
  finding(
    'conformite.trackers.without_banner:a1',
    'conformite.trackers.without_banner',
    'conformite',
    'P0',
    'Traceurs chargés sans consentement',
    'Google Analytics, Meta Pixel et Hotjar se chargent dès l’arrivée sur la page, avant tout choix du visiteur.',
    'La CNIL sanctionne ce cas, même pour une petite entreprise.',
    'Installer un bandeau de consentement qui bloque les traceurs tant que le visiteur n’a pas accepté.',
    {
      legal_refs: [
        {
          standard: 'CNIL',
          label: 'CNIL, lignes directrices cookies',
          url: 'https://www.cnil.fr/fr/cookies-et-autres-traceurs',
        },
      ],
    },
  ),
  finding(
    'conformite.privacy.missing:a2',
    'conformite.privacy.missing',
    'conformite',
    'P0',
    'Politique de confidentialité absente',
    'Aucune page ne décrit l’usage des données des clients (formulaire de commande, newsletter).',
    'Obligation RGPD. Un client qui cherche cette page et ne la trouve pas perd confiance.',
    'Publier une politique de confidentialité et la lier dans le pied de page.',
    {
      legal_refs: [
        {
          standard: 'RGPD',
          label: 'RGPD, articles 12 à 14',
          url: 'https://www.cnil.fr/fr/reglement-europeen-protection-donnees',
        },
      ],
    },
  ),
  finding(
    'perf.lcp.slow:b1',
    'perf.lcp.slow',
    'performance',
    'P1',
    'Affichage principal lent sur mobile',
    'Le plus grand élément (photo du gâteau du moment) s’affiche après 4,6 s sur mobile.',
    'Au-delà de 2,5 s, une partie des visiteurs mobiles quitte la page.',
    'Servir la photo en WebP, à la bonne taille, et la précharger.',
    {
      narrative_code_snippet:
        '<link rel="preload" as="image" href="/wp-content/uploads/gateau-du-moment.webp" fetchpriority="high">',
    },
  ),
  finding(
    'perf.images.not_lazy:b2',
    'perf.images.not_lazy',
    'performance',
    'P2',
    'Images chargées d’un coup',
    '14 images sous la ligne de flottaison se chargent dès l’ouverture.',
    'La page pèse 6 Mo, ce qui ralentit tout le reste.',
    'Ajouter loading="lazy" sur les images hors du premier écran.',
  ),
  finding(
    'a11y.images.missing_alt:d1',
    'a11y.images.missing_alt',
    'accessibilite',
    'P1',
    '9 images sans texte alternatif',
    'Les photos des produits n’ont pas d’attribut alt.',
    'Un lecteur d’écran annonce « image » sans dire laquelle. C’est aussi une perte en SEO image.',
    'Décrire chaque produit en quelques mots dans l’attribut alt.',
    {
      legal_refs: [
        {
          standard: 'RGAA',
          version: '4.1',
          criterion: '1.1',
          label: 'RGAA 1.1',
          url: 'https://accessibilite.numerique.gouv.fr/methode/criteres-et-tests/#1.1',
        },
      ],
    },
  ),
  finding(
    'a11y.skip_link.missing:d2',
    'a11y.skip_link.missing',
    'accessibilite',
    'P2',
    'Pas de lien d’évitement',
    'Au clavier, il faut traverser tout le menu avant d’atteindre le contenu.',
    'Gêne les personnes qui naviguent au clavier.',
    'Ajouter un lien « Aller au contenu » en tout début de page.',
  ),
  finding(
    'conversion.cta.not_above_fold:c1',
    'conversion.cta.not_above_fold',
    'conversion',
    'P1',
    'Bouton de commande sous la ligne de flottaison',
    'Le bouton « Commander un gâteau » n’apparaît qu’après deux écrans de défilement.',
    'Les visiteurs venus pour commander doivent le chercher.',
    'Placer le bouton dans le premier écran, à côté de la photo principale.',
  ),
  finding(
    'seo.meta_description.missing:e1',
    'seo.meta_description.missing',
    'seo_technique',
    'P2',
    'Méta description absente sur 3 pages',
    'Les pages Gâteaux, Contact et La boutique n’ont pas de description.',
    'Google choisit alors un extrait au hasard dans la page.',
    'Rédiger une description de 140 à 160 caractères par page.',
  ),
  finding(
    'seo.json_ld.absent:e2',
    'seo.json_ld.absent',
    'seo_technique',
    'P2',
    'Pas de données structurées',
    'Aucune donnée LocalBusiness (horaires, adresse, téléphone).',
    'La fiche n’apparaît pas enrichie dans les résultats locaux.',
    'Ajouter un bloc JSON-LD de type Bakery avec les horaires et l’adresse.',
  ),
  finding(
    'seo_contenu.blog.absent:f1',
    'seo_contenu.blog.absent',
    'seo_contenu',
    'P3',
    'Pas de contenu éditorial',
    'Aucune page de conseils ou d’actualités.',
    'Moins de requêtes couvertes (gâteau d’anniversaire, galette…).',
    'Publier une page par grande occasion de l’année.',
  ),
];

export const EXAMPLE_AGENCY: BuildAgency = {
  name: 'Atelier Pixel',
  websiteUrl: 'https://atelier-pixel.fr',
  contactUrl: 'https://atelier-pixel.fr/contact',
  logoUrl: null,
  color: '#7C3AED',
  footer: 'Atelier Pixel, studio web à Lyon. 12 rue des Capucins, 69001 Lyon.',
};

/** Example report data for a template (its default settings). */
export function exampleReportData(
  bundle: TemplateBundle,
  mode: 'web' | 'print' = 'web',
  stored: Record<string, unknown> | null = null,
): ReportDataV1 {
  const { values, sections } = resolveSettings(bundle.manifest, stored);
  return buildReportData({
    audit: EXAMPLE_AUDIT,
    findings: EXAMPLE_FINDINGS,
    agency: EXAMPLE_AGENCY,
    context: {
      mode,
      shareUrl: 'https://audit.atelier-pixel.fr/r/exempleDeJeton0123456789',
      pdfUrl: '/api/audits/full/ex4mpleSlug01/pdf',
      tracking: true,
      label: 'Boulangerie Martin',
      faviconUrl: null,
      now: new Date('2026-11-02T10:00:00.000Z'),
    },
    template: {
      id: bundle.manifest.id,
      name: bundle.manifest.name,
      version: bundle.manifest.version,
      values,
      sections,
    },
  });
}
