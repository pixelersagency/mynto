/**
 * Sector-specific knowledge injected into the LLM prompt.
 *
 * The model gets a tailored briefing per detected sector instead of
 * the generic "adapt to the sector" instruction. Each entry covers:
 *   - The main acquisition channel for the sector
 *   - Trust signals that genuinely matter
 *   - Common friction points specific to the vertical
 *   - Specific findings to push hard
 *   - Language quirks / vocabulary
 *
 * Selected by matching `detected` against the keys. Falls back to
 * GENERIC if no match.
 */

export interface SectorKnowledge {
  sector: string;
  // Headline used in prompt to give context up-front
  context: string;
  // Channels of acquisition the consultant should reason about
  acquisitionChannels: string[];
  // Trust signals that matter for THIS sector specifically
  trustSignals: string[];
  // Specific friction points common in the sector
  frictionPoints: string[];
  // Findings to push hard if detected
  prioritizedFindings: string[];
  // Vocabulary to use (KPIs, terms)
  vocabulary: string[];
}

export const SECTOR_KNOWLEDGE: Record<string, SectorKnowledge> = {
  agence_wp: {
    sector: 'agence WordPress / agence web B2B FR/BE/CH',
    context:
      "Acquisition principalement via démarchage LinkedIn outbound + SEO local. Cible = PME 10-200 personnes, dirigeant ou marketing manager. Le prospect arrive après avoir vu un message LinkedIn et atterrit pour vérifier la crédibilité. Décision rapide (10-30s avant de fermer l'onglet). DSI signe rarement au premier audit, processus avec 2-3 personnes.",
    acquisitionChannels: [
      'LinkedIn outreach 1-to-1 (asynchrone, le prospect re-googlera après le message)',
      'SEO BOFU sur "agence WordPress [ville]", "Bricks Builder agency", "refonte site WordPress B2B"',
      'Recommandations de pair-à-pair entre marketing managers',
      'Communauté Bricks Builder / Elementor (différenciation tech)',
    ],
    trustSignals: [
      'Cas clients chiffrés (résultats avant/après en €, conversion, trafic)',
      'Témoignages avec photo + LinkedIn dirigeant client (pas "Marie L., satisfaite")',
      'Logos clients reconnaissables (PME locales OK, pas que des Fortune 500 fake)',
      'Pricing affiché publiquement (signal "transparent", énorme pour PME)',
      'Page équipe avec photos et bios (acheteur DSI scrute toujours)',
      'Articles BOFU type "Comment choisir agence WP" / comparatifs Webflow',
    ],
    frictionPoints: [
      'Pas de pricing affiché → suggère "négociation lourde, trop cher"',
      'Témoignages anonymes → suggère "pas vraiment de clients satisfaits"',
      'GA/Hotjar sans bannière → contradicte le pitch "expert WordPress + RGPD"',
      'Pas de blog → pas de longue traîne, pas de SEO BOFU possible',
      'Pas de cas client détaillé avec chiffres → pas de preuve sociale concrète',
      'Site qui charge lentement → cas d\'école "le cordonnier mal chaussé"',
    ],
    prioritizedFindings: [
      'conversion.testimonials.thin (témoignages anonymes = killer credibility)',
      'conversion.pricing.anchor_only (no /pricing = friction commerciale)',
      'conformite.trackers.without_banner (paradoxe expert RGPD)',
      'seo_contenu.blog.absent (pas de BOFU = pas de longue traîne)',
    ],
    vocabulary: [
      'demandes de devis',
      'projets entrants',
      'pipeline commercial',
      'taux de signature',
      'DSI',
      'marketing manager',
      'dirigeant',
      'BOFU',
      'MOFU',
      'longue traîne SEO',
    ],
  },
  formation: {
    sector: 'organisme de formation professionnelle B2B (Qualiopi)',
    context:
      "Acquisition via SEO 'formation [thème] [ville]', 'formation CPF [thème]', 'formation OPCO', + LinkedIn. Cible = responsables RH, formation, ou direction PME. Décision longue (négociation OPCO, validation CPF). La conformité Qualiopi + ICR/CIR est un signal de sérieux scruté avant inscription.",
    acquisitionChannels: [
      'SEO "formation [thème] [ville]"',
      'Référencement Qualiopi + Mon Compte Formation',
      'LinkedIn RH / formation',
      'Plateformes OPCO',
    ],
    trustSignals: [
      'Numéro Qualiopi visible + logo officiel',
      "Numéro de déclaration d'activité (NDA)",
      'Mentions OPCO / CPF / Pôle Emploi',
      'Taux de réussite, satisfaction (chiffré par session)',
      'Page formateurs avec bios + diplômes',
      "Témoignages d'entreprises clientes nominatives",
    ],
    frictionPoints: [
      'Pas de page détaillée par formation (programme, prérequis, durée, financement)',
      'Pas de mention Qualiopi visible immédiatement',
      'Tarifs cachés (les responsables RH scrutent pour comparer OPCO)',
      'Pas de calendrier de sessions à jour',
      "Pas de témoignages d'entreprises (les particuliers se méfient)",
    ],
    prioritizedFindings: [
      'conversion.testimonials.thin',
      'conversion.pricing.anchor_only',
      'seo_contenu.blog.absent (pas de FAQ détaillée par thématique = perte SEO)',
    ],
    vocabulary: [
      'demandes de devis',
      'inscriptions session',
      'téléchargement catalogue',
      'OPCO',
      'CPF',
      'Qualiopi',
      'formation professionnelle continue',
      'responsable formation',
    ],
  },
  immobilier: {
    sector: 'agence immobilière locale (achat/vente, location)',
    context:
      "Acquisition via SEO local 'immobilier [ville]', 'estimation gratuite [ville]', + bouche-à-oreille + portails (SeLoger, Bien'ici, Leboncoin). Le visiteur est très peu engagé au premier passage (compare 3-5 agences), revient après comparaison. Friction principale : preuve d'expertise locale et facilité de prise de contact rapide.",
    acquisitionChannels: [
      'SEO local "agence immobilière [ville]"',
      'Estimation gratuite (lead magnet principal)',
      "Portails de diffusion (SeLoger, Bien'ici, Leboncoin)",
      'Recommandations clients existants',
    ],
    trustSignals: [
      'Carte pro affichée + garantie financière (obligatoires)',
      'Avis Google reviews intégrés avec note moyenne',
      'Photos HD des biens (10+ par fiche)',
      "Équipe avec photos, mention années d'expérience locale",
      'Visites virtuelles 3D ou vidéo',
      'Chiffres "X biens vendus en 2024", "X% en moins de 3 mois"',
    ],
    frictionPoints: [
      "Pas d'estimation gratuite visible above the fold",
      'Photos biens médiocres ou trop peu nombreuses',
      "Pas de carte interactive de la zone d'activité",
      'Téléphone caché ou difficile à trouver',
      'Pas de chat WhatsApp / SMS pour contact rapide',
    ],
    prioritizedFindings: [
      'conversion.cta.not_above_fold (estimation = CTA #1)',
      'conversion.contact.thin (téléphone/whatsapp absent)',
      'seo_technique.json_ld.absent (LocalBusiness + RealEstate schema = gros SEO local)',
    ],
    vocabulary: [
      "demandes d'estimation",
      'visites prises',
      'dépôts de mandats',
      'estimation gratuite',
      'carte pro',
      'mandat exclusif/simple',
      'zone de chalandise',
    ],
  },
  hotellerie: {
    sector: 'hôtellerie / restauration (réservations directes)',
    context:
      'Acquisition partagée entre Booking/TheFork/Google Maps + SEO direct. Enjeu majeur : récupérer la réservation directe (commission Booking = 15-25%) vs canaux indirects. Le visiteur est high-intent (cherche un endroit pour ce soir / ce week-end). Décision en 30s à 5 min. Mobile first.',
    acquisitionChannels: [
      'Google Maps + reviews',
      'SEO local "restaurant [ville] [type cuisine]"',
      'Booking.com / TheFork (à siphonner vers réservation directe)',
      'Instagram (visuel)',
    ],
    trustSignals: [
      'Photos de qualité (plats, lieu, ambiance), pas stockphoto',
      'Avis Google + TripAdvisor avec note ≥ 4.0/5',
      'Chef nommé avec photo (restos) ou propriétaire (hôtels)',
      'Bouton "Réserver" omniprésent',
      'Disponibilités en temps réel (pas formulaire "on vous rappelle")',
    ],
    frictionPoints: [
      'Pas de bouton réservation above the fold',
      'Menu/carte pas téléchargeable ou pas visible',
      'Téléphone difficile à appuyer sur mobile (lien tel: manquant)',
      'Pas de système de réservation intégré (TheFork, Resy, Custom)',
      'Photos médiocres ou stockphotos',
    ],
    prioritizedFindings: [
      'conversion.cta.not_above_fold (réservation = unique CTA)',
      'conversion.contact.thin (tel: link obligatoire)',
      'seo_technique.json_ld.absent (LocalBusiness + Restaurant schema = critique Google Maps)',
    ],
    vocabulary: [
      'réservations directes',
      'commission Booking',
      'note moyenne Google',
      'photos lifestyle',
      'carte/menu',
    ],
  },
  saas_b2b: {
    sector: 'SaaS B2B (essai gratuit, démo, plan tarifaire)',
    context:
      "Acquisition multi-canal : SEO BOFU sur 'best [category] software', LinkedIn outreach, content marketing, partenariats. Le visiteur est high-intent (compare 3-5 outils). Décision longue (POC, démo, sécurité). Trust + pricing transparent + ROI démontrable = critères.",
    acquisitionChannels: [
      'SEO BOFU "best CRM [vertical]", "alternative to [competitor]"',
      'Démo bookings via Calendly intégré',
      'LinkedIn organic + ads',
      'Content marketing (blog technique + études de cas)',
    ],
    trustSignals: [
      'Études de cas avec chiffres (X% gain, $Y économisés)',
      'Logos clients reconnaissables',
      'Page sécurité (SOC2, RGPD, ISO 27001, infrastructure)',
      'Documentation publique',
      'Page "pricing" transparente avec tiers visibles',
      'Intégrations listées (logos partenaires)',
    ],
    frictionPoints: [
      'Pricing caché derrière "Contact Sales"',
      'Pas de démo vidéo / interactive en home',
      'Pas de page sécurité (DSI bloque ici)',
      "Pas d'essai gratuit ou trop court (< 14 jours)",
      'Études de cas qualitatives sans chiffres',
    ],
    prioritizedFindings: [
      'conversion.pricing.anchor_only (pricing flou = signal mauvais)',
      'seo_technique.json_ld.absent (SoftwareApplication schema = SEO BOFU)',
      'seo_contenu.blog.absent (BOFU = blog comparatif obligatoire)',
    ],
    vocabulary: [
      'démos bookées',
      'free trial activés',
      'leads MQL',
      'POC',
      'ARR',
      'pipeline commercial',
      'churn',
    ],
  },
  ecommerce: {
    sector: 'e-commerce B2C (vente en ligne)',
    context:
      'Acquisition mix paid social (Meta/TikTok) + SEO produit + retargeting. Le visiteur arrive sur page produit, pas home (ads). Décision en quelques minutes max. Friction principale : confiance (avis, livraison, retours) + UX checkout. Mobile 60-80% du trafic.',
    acquisitionChannels: [
      'Meta Ads / TikTok Ads (produit unique ou catégorie)',
      'SEO catégorie + fiche produit',
      'Email marketing (newsletter, retargeting)',
      'Influence marketing',
    ],
    trustSignals: [
      'Avis Trustpilot intégrés (note + nombre)',
      'Photos produit HD multi-angles + zoom',
      'Politique de retour claire (30j, gratuit)',
      'Livraison rapide annoncée (24-48h)',
      'Paiement 3x sans frais visible',
      'Logos paiement sécurisés (CB, PayPal, Apple Pay)',
    ],
    frictionPoints: [
      "Frais de livraison cachés jusqu'au checkout (-55% complétion Baymard)",
      'Photos produit médiocres (stockphoto fournisseur)',
      "Pas d'avis client sur fiche produit",
      'Checkout > 3 étapes',
      'LCP mobile > 3s (Google study : -7% conv/+1s)',
    ],
    prioritizedFindings: [
      'perf.lcp.slow (mobile e-commerce = critique conv)',
      'conversion.testimonials.thin (avis = trust signal #1)',
      'perf.images.missing_dimensions (CLS = pénalité Google)',
    ],
    vocabulary: [
      'conversions panier',
      'panier moyen (AOV)',
      "taux d'abandon checkout",
      'frais de livraison',
      'retours',
      'fidélisation',
    ],
  },
  restauration: {
    sector: 'restauration (restaurant traditionnel, brasserie, gastro)',
    context:
      'Le visiteur cherche un restau pour ce soir / week-end. Décision en 30s à 2 min. Photos + avis + facilité de réservation = trio gagnant. Mobile-first (95%+ du trafic local).',
    acquisitionChannels: [
      'Google Maps + reviews',
      'SEO local "restaurant [ville] [type cuisine]"',
      'TheFork / SevenRooms',
      'Instagram',
    ],
    trustSignals: [
      'Photos plats et lieu HD',
      'Avis Google ≥ 4.0/5 nombreux',
      'Chef nommé avec photo',
      'Menu visible directement (pas téléchargement PDF)',
      'Bouton réservation TheFork / direct',
    ],
    frictionPoints: [
      "Menu en PDF (Google ne l'indexe pas)",
      'Pas de bouton réservation visible',
      'Pas de photos plats',
      'Téléphone non cliquable mobile',
    ],
    prioritizedFindings: [
      'conversion.cta.not_above_fold',
      'conversion.contact.thin',
      'seo_technique.json_ld.absent',
    ],
    vocabulary: ['réservations en ligne', 'appels téléphone', 'menu', 'carte'],
  },
  services_pro: {
    sector: 'services professionnels (avocats, expertise comptable, conseil)',
    context:
      'Acquisition via SEO local + recommandations + LinkedIn. Le visiteur cherche une expertise spécifique, compare 3-5 cabinets avant de demander un RDV. Décision basée sur expertise visible + facilité de contact. Friction principale : opacité tarifaire + manque de spécialisation visible.',
    acquisitionChannels: [
      'SEO local "avocat [domaine] [ville]", "expert-comptable [secteur]"',
      'Recommandations clients',
      'LinkedIn personal branding (associés)',
      'Pages Avocat.fr / Doctolib pro / annuaires sectoriels',
    ],
    trustSignals: [
      'Présentation associés avec photos + parcours + expertise',
      'Domaines d\'intervention détaillés (pas "droit des affaires" générique)',
      "Articles d'expertise (preuve de compétence)",
      'Mentions ordre/barreau visibles',
      'Témoignages clients B2B nominatifs',
      'Modalités tarifaires (forfait, honoraire au temps, etc.)',
    ],
    frictionPoints: [
      'Présentation équipe vague ou photos manquantes',
      "Pas de domaines d'intervention détaillés (généralisme = pas spécialiste)",
      'Pas de prise de RDV en ligne (Calendly, Doctolib pro)',
      "Pas d'articles d'expertise (rien à montrer)",
    ],
    prioritizedFindings: [
      'conversion.contact.thin',
      'conversion.testimonials.thin',
      "seo_contenu.blog.absent (articles d'expertise critiques)",
    ],
    vocabulary: [
      'prises de RDV',
      'demandes de contact',
      'consultations',
      'expertise',
      'cabinet',
      'associé',
      'honoraires',
    ],
  },
  generic: {
    sector: "site générique (à préciser dans l'analyse)",
    context:
      "Tu n'as pas de profil sectoriel précis. Identifie le secteur réel depuis le contenu et adapte le ton, mais sans inventer de connaissance sectorielle que tu n'aurais pas.",
    acquisitionChannels: ['Mix SEO + direct + social, à préciser'],
    trustSignals: ['À identifier selon le contexte business'],
    frictionPoints: ['À déduire des findings'],
    prioritizedFindings: [],
    vocabulary: ['conversions', 'trafic organique'],
  },
};

/**
 * Lookup with fuzzy matching on the LLM's sector hint.
 * Falls back to GENERIC if no key matches.
 */
function lookup(key: string): SectorKnowledge {
  const entry = SECTOR_KNOWLEDGE[key];
  if (!entry) {
    throw new Error(`Missing sector knowledge entry for "${key}"`);
  }
  return entry;
}

export function getSectorKnowledge(detectedSector: string): SectorKnowledge {
  const normalized = detectedSector.toLowerCase();
  if (/agence|wordpress|wp\b|webflow|web\s*agency/.test(normalized)) return lookup('agence_wp');
  if (/formation|qualiopi|opco|cpf/.test(normalized)) return lookup('formation');
  if (/immobil|agence\s+immo/.test(normalized)) return lookup('immobilier');
  if (/hotel|hôtel|hospitalit/.test(normalized)) return lookup('hotellerie');
  if (/saas|software|cloud|api|plateforme b2b/.test(normalized)) return lookup('saas_b2b');
  if (/e[-\s]?commerce|boutique|panier|shopify|cosm[ée]tique/.test(normalized)) {
    return lookup('ecommerce');
  }
  if (/restau|brasserie|gastr|chef/.test(normalized)) return lookup('restauration');
  if (/avocat|notaire|expert.compt|conseil|cabinet/.test(normalized)) return lookup('services_pro');
  return lookup('generic');
}

export function formatSectorBriefing(k: SectorKnowledge): string {
  return `
# CONTEXTE SECTORIEL : ${k.sector}

**Comment ils acquièrent leurs clients :**
${k.acquisitionChannels.map((c) => `- ${c}`).join('\n')}

**Trust signals critiques pour ce secteur :**
${k.trustSignals.map((s) => `- ${s}`).join('\n')}

**Points de friction typiques :**
${k.frictionPoints.map((f) => `- ${f}`).join('\n')}

**Findings à pousser fort si détectés :**
${k.prioritizedFindings.map((f) => `- ${f}`).join('\n')}

**Vocabulaire à utiliser :**
${k.vocabulary.join(' · ')}

**Contexte business :**
${k.context}
`.trim();
}
