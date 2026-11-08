import { z } from 'zod';

/**
 * "Préparation IA" (agent readiness): optional 9th module of the audit.
 *
 * Answers "can an AI agent find, read and use this site?" with 24
 * deterministic tests (HTTP probes, robots.txt parsing, a DNS lookup).
 * No LLM, no headless browser. Ported from the original Mynto "audit IA".
 *
 * Results live in `audits_full.ai_readiness` (jsonb) and `audits_full.ai_score`
 * (0-100). The score is NOT part of the global 8-axis score unless the
 * install setting `ai_in_global_score` is on.
 */

export const AiCheckCategorySchema = z.enum([
  'discoverability',
  'content_accessibility',
  'bot_access',
  'protocol_discovery',
  'commerce',
]);
export type AiCheckCategory = z.infer<typeof AiCheckCategorySchema>;

export const AI_CHECK_CATEGORIES = [
  'discoverability',
  'content_accessibility',
  'bot_access',
  'protocol_discovery',
  'commerce',
] as const;

export const AiCheckIdSchema = z.enum([
  // discoverability
  'robots_txt',
  'sitemap',
  'link_headers',
  'dns_aid',
  // content accessibility
  'markdown_negotiation',
  'llms_txt',
  'no_js_content',
  // bot access control
  'ai_bot_rules',
  'content_signals',
  'web_bot_auth',
  'ai_bot_live_access',
  // protocol discovery
  'mcp_server_card',
  'a2a_agent_card',
  'agent_skills',
  'webmcp',
  'api_catalog',
  'oauth_discovery',
  'oauth_protected_resource',
  'auth_md',
  'ard_manifest',
  // commerce
  'x402',
  'mpp',
  'ucp',
  'acp',
]);
export type AiCheckId = z.infer<typeof AiCheckIdSchema>;

/** Every check id, in report order. */
export const AI_CHECK_IDS: readonly AiCheckId[] = AiCheckIdSchema.options;

/**
 * `pass` / `fail` count in the score. `neutral` is informational only (the
 * standard is optional or not applicable to this kind of site) and
 * `skipped` means the probe could not run (network, DNS resolver down).
 * Both leave the denominator, so a dead probe never reads as a bad site.
 */
export const AiCheckStatusSchema = z.enum(['pass', 'fail', 'neutral', 'skipped']);
export type AiCheckStatus = z.infer<typeof AiCheckStatusSchema>;

export const AiCheckEvidenceSchema = z.object({
  label: z.string(),
  url: z.string().optional(),
  status: z.union([z.number(), z.string()]).optional(),
  detail: z.string().optional(),
});
export type AiCheckEvidence = z.infer<typeof AiCheckEvidenceSchema>;

export const AiCheckResultSchema = z.object({
  id: AiCheckIdSchema,
  category: AiCheckCategorySchema,
  status: AiCheckStatusSchema,
  /** French one-liner: what was measured on this site. */
  message: z.string(),
  evidence: z.array(AiCheckEvidenceSchema).default([]),
  /** Spec / documentation links backing the check. */
  specUrls: z.array(z.string()).default([]),
  /** French fix instruction, ready to paste into a coding agent. Only on failures. */
  fixPrompt: z.string().optional(),
  /** Weight in the score. 0 for purely informational checks. */
  weight: z.number(),
  /** False when the standard is out of scope for this site type. */
  applicable: z.boolean().optional(),
});
export type AiCheckResult = z.infer<typeof AiCheckResultSchema>;

/**
 * Site type. Decides which standards are relevant: a showcase site is not
 * blamed for having no MCP server or agentic checkout.
 */
export const AiSiteTypeSchema = z.enum(['vitrine', 'contenu', 'app_api', 'ecommerce']);
export type AiSiteType = z.infer<typeof AiSiteTypeSchema>;

/** `auto` only exists as an input: the scanner resolves it from the home page. */
export const AiSiteTypeInputSchema = z.enum(['auto', 'vitrine', 'contenu', 'app_api', 'ecommerce']);
export type AiSiteTypeInput = z.infer<typeof AiSiteTypeInputSchema>;

export const AI_SITE_TYPE_INPUTS = AiSiteTypeInputSchema.options;

export const AI_SITE_TYPE_LABEL: Record<AiSiteTypeInput, string> = {
  auto: 'Détection automatique',
  vitrine: 'Site vitrine',
  contenu: 'Site de contenu',
  app_api: 'Application ou API',
  ecommerce: 'E-commerce',
};

export const AI_SITE_TYPE_DESCRIPTION: Record<AiSiteTypeInput, string> = {
  auto: 'Le scanner lit la page d’accueil et choisit le bon jeu de tests.',
  vitrine: 'Présentation, services, contact. Pas d’API ni de compte client.',
  contenu: 'Blog, média, documentation, base de connaissance.',
  app_api: 'SaaS, application web, API publique, espace client.',
  ecommerce: 'Boutique en ligne, panier, paiement.',
};

/** Highest level reachable per site type: a showcase site has nothing to expose above 3. */
export const AI_SITE_TYPE_MAX_LEVEL: Record<AiSiteType, number> = {
  vitrine: 3,
  contenu: 3,
  app_api: 4,
  ecommerce: 5,
};

/** Maturity ladder. A level is reached only when every level below it is. */
export const AI_LEVELS = [
  { level: 0, name: 'Invisible', short: 'Aucun signal exploitable par un agent.' },
  { level: 1, name: 'Présence de base', short: 'robots.txt et sitemap valides.' },
  { level: 2, name: 'Prêt pour les robots d’IA', short: 'Règles claires pour les robots d’IA.' },
  { level: 3, name: 'Lisible par les agents', short: 'Contenu récupérable sans navigateur.' },
  { level: 4, name: 'Interopérable', short: 'Services proposés aux agents par MCP, A2A ou API.' },
  { level: 5, name: 'Transactionnel', short: 'Un agent peut acheter ou payer.' },
] as const;

/**
 * Stored result (`audits_full.ai_readiness`). `status: 'failed'` means no
 * probe of the origin completed: nothing was measured, so there is no score
 * (never a 0 that would call a healthy site invisible).
 */
export const AiReadinessResultSchema = z.object({
  version: z.literal(1),
  status: z.enum(['completed', 'failed']),
  scanned_at: z.string(),
  /** 0-100, null when the run failed. */
  score: z.number().int().min(0).max(100).nullable(),
  level: z.number().int().min(0).max(5).nullable(),
  level_name: z.string().nullable(),
  /** Level ceiling of the site type. */
  max_level: z.number().int().min(0).max(5),
  /** Resolved site type (never `auto`). */
  site_type: AiSiteTypeSchema,
  /** True when the type was detected rather than chosen. */
  site_type_auto: z.boolean(),
  /** Signals behind the detection (empty when the type was chosen). */
  site_type_signals: z.array(z.string()).default([]),
  /** Whether this score was folded into the global score of the audit. */
  included_in_global_score: z.boolean().default(false),
  /** Short machine code when the run failed (e.g. `site_unreachable`). */
  error: z.string().nullable().default(null),
  checks: z.array(AiCheckResultSchema).default([]),
});
export type AiReadinessResult = z.infer<typeof AiReadinessResultSchema>;

/** Lenient read of a stored value: null when absent or malformed. */
export function parseStoredAiReadiness(value: unknown): AiReadinessResult | null {
  if (value === null || value === undefined) return null;
  const parsed = AiReadinessResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Score below this is flagged "Préparation IA faible" (dashboard filter). */
export const AI_READINESS_LOW_THRESHOLD = 50;

/** Pseudo-axis of the AI readiness findings in the API (never in axis_scores). */
export const AI_READINESS_AXIS = 'ia' as const;

/** Rule code of a check in the findings API and analytics: `ia.<check_id>`. */
export function aiRuleCode(id: AiCheckId): string {
  return `ia.${id}`;
}

export const AI_CHECK_CATEGORY_LABEL: Record<AiCheckCategory, string> = {
  discoverability: 'Découvrabilité',
  content_accessibility: 'Accès au contenu',
  bot_access: 'Contrôle des bots IA',
  protocol_discovery: 'Protocoles agents',
  commerce: 'Commerce agentique',
};

export const AI_CHECK_LABEL: Record<AiCheckId, string> = {
  robots_txt: 'robots.txt',
  sitemap: 'Sitemap',
  link_headers: 'En-têtes Link',
  dns_aid: 'DNS pour agents (DNS-AID)',
  markdown_negotiation: 'Version Markdown',
  llms_txt: 'llms.txt',
  no_js_content: 'Contenu sans JavaScript',
  ai_bot_rules: 'Règles pour les robots d’IA',
  content_signals: 'Signaux de contenu',
  web_bot_auth: 'Web Bot Auth',
  ai_bot_live_access: 'Accès réel des robots d’IA',
  mcp_server_card: 'Fiche de serveur MCP',
  a2a_agent_card: 'Fiche d’agent A2A',
  agent_skills: 'Agent Skills',
  webmcp: 'WebMCP',
  api_catalog: 'Catalogue d’API',
  oauth_discovery: 'Découverte OAuth',
  oauth_protected_resource: 'Ressource protégée OAuth',
  auth_md: 'auth.md',
  ard_manifest: 'Manifeste ARD',
  x402: 'x402',
  mpp: 'MPP',
  ucp: 'UCP',
  acp: 'ACP',
};

export const AI_CHECK_DESCRIPTION: Record<AiCheckId, string> = {
  robots_txt: 'Fichier robots.txt présent et lisible par les robots.',
  sitemap: 'Plan du site en XML, accessible et déclaré dans robots.txt.',
  link_headers: 'En-têtes HTTP Link qui indiquent aux agents les versions lisibles par une machine.',
  dns_aid: 'Enregistrements DNS _agents qui indiquent aux agents où s’adresser.',
  markdown_negotiation: 'Le site renvoie du Markdown quand un agent le demande.',
  llms_txt: 'Fichier llms.txt qui résume le site pour les modèles d’IA.',
  no_js_content: 'Le contenu est lisible sans exécuter de JavaScript.',
  ai_bot_rules: 'robots.txt nomme les robots d’IA et dit ce qu’ils peuvent faire.',
  content_signals: 'Lignes Content-Signal qui disent comment l’IA peut utiliser le contenu.',
  web_bot_auth: 'Annuaire de signatures qui permet de reconnaître les robots légitimes.',
  ai_bot_live_access: 'Le serveur laisse vraiment passer les robots d’IA, sans blocage du pare-feu.',
  mcp_server_card: 'Fiche qui présente aux agents les outils MCP du site.',
  a2a_agent_card: 'Fiche qui présente l’agent du site aux autres agents (A2A).',
  agent_skills: 'Liste des compétences que le site met à disposition des agents.',
  webmcp: 'Outils WebMCP déclarés dans la page pour les agents qui naviguent.',
  api_catalog: 'Catalogue (RFC 9727) qui liste les descriptions d’API du site.',
  oauth_discovery: 'Description OAuth ou OpenID Connect pour qu’un agent puisse se connecter.',
  oauth_protected_resource: 'Description des ressources protégées (RFC 9728).',
  auth_md: 'Fichier auth.md qui explique en clair comment se connecter.',
  ard_manifest: 'Manifeste ARD qui liste les ressources utiles aux agents.',
  x402: 'Paiement de machine à machine par le code HTTP 402.',
  mpp: 'Merchant Payments Protocol, pour qu’un agent puisse payer.',
  ucp: 'Universal Commerce Protocol, pour le catalogue et le panier.',
  acp: 'Agentic Commerce Protocol, pour un paiement mené par un agent.',
};

export const AI_CHECK_STATUS_LABEL: Record<AiCheckStatus, string> = {
  pass: 'Réussi',
  fail: 'À corriger',
  neutral: 'Facultatif',
  skipped: 'Non testé',
};

/** pass / (pass + fail) of a set of checks. */
export function aiScoredCounts(checks: readonly AiCheckResult[]): {
  passed: number;
  total: number;
} {
  const scored = checks.filter((c) => c.status === 'pass' || c.status === 'fail');
  return { passed: scored.filter((c) => c.status === 'pass').length, total: scored.length };
}
