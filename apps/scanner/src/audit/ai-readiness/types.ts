import type {
  AiCheckCategory,
  AiCheckId,
  AiCheckResult,
  AiCheckStatus,
  AiSiteType,
} from '@mynto/shared';

import type { ProbeResult } from './probe.js';

export interface AiAuditLogger {
  info: (o: unknown, m?: string) => void;
  warn: (o: unknown, m?: string) => void;
  error: (o: unknown, m?: string) => void;
}

/**
 * Shared context handed to every check. The home page and robots.txt are
 * fetched once up front because half the checks read from them; the rest
 * of the probes are the check's own business.
 */
export interface AiAuditContext {
  /** Normalized target URL, as submitted (may carry a path). */
  targetUrl: string;
  /** Scheme + host of the target. */
  origin: string;
  /** Registrable host used for DNS lookups. */
  host: string;
  home: ProbeResult;
  robots: ProbeResult;
  /** Site type driving which checks apply. Never `auto` at this point. */
  siteType: AiSiteType;
  /** True when the type was guessed rather than chosen by the visitor. */
  siteTypeAuto: boolean;
  /** Signals behind the guess (empty when the visitor chose the type). */
  siteTypeSignals: string[];
  /** True when the resolved type is `ecommerce`. */
  isCommerce: boolean;
  /** Whether a given check is worth running for this site type. */
  applies: (id: AiCheckId) => boolean;
  logger: AiAuditLogger;
}

export interface AiAuditOutcome {
  scannedAt: string;
  url: string;
  score: number;
  level: number;
  levelName: string;
  siteType: AiSiteType;
  siteTypeAuto: boolean;
  siteTypeSignals: string[];
  /** Level ceiling of the site type. */
  maxLevel: number;
  isCommerce: boolean;
  checks: AiCheckResult[];
}

/** Weight per check. 0 = informational, excluded from the score. */
export const CHECK_WEIGHTS: Record<AiCheckId, number> = {
  robots_txt: 3,
  sitemap: 3,
  link_headers: 2,
  dns_aid: 1,
  markdown_negotiation: 3,
  llms_txt: 2,
  no_js_content: 3,
  ai_bot_rules: 3,
  content_signals: 2,
  web_bot_auth: 0,
  ai_bot_live_access: 3,
  mcp_server_card: 2,
  a2a_agent_card: 1,
  agent_skills: 1,
  webmcp: 1,
  api_catalog: 1,
  oauth_discovery: 1,
  oauth_protected_resource: 1,
  auth_md: 1,
  ard_manifest: 1,
  x402: 1,
  mpp: 1,
  ucp: 1,
  acp: 1,
};

export const CHECK_CATEGORY: Record<AiCheckId, AiCheckCategory> = {
  robots_txt: 'discoverability',
  sitemap: 'discoverability',
  link_headers: 'discoverability',
  dns_aid: 'discoverability',
  markdown_negotiation: 'content_accessibility',
  llms_txt: 'content_accessibility',
  no_js_content: 'content_accessibility',
  ai_bot_rules: 'bot_access',
  content_signals: 'bot_access',
  web_bot_auth: 'bot_access',
  ai_bot_live_access: 'bot_access',
  mcp_server_card: 'protocol_discovery',
  a2a_agent_card: 'protocol_discovery',
  agent_skills: 'protocol_discovery',
  webmcp: 'protocol_discovery',
  api_catalog: 'protocol_discovery',
  oauth_discovery: 'protocol_discovery',
  oauth_protected_resource: 'protocol_discovery',
  auth_md: 'protocol_discovery',
  ard_manifest: 'protocol_discovery',
  x402: 'commerce',
  mpp: 'commerce',
  ucp: 'commerce',
  acp: 'commerce',
};

interface BuildCheckInput {
  id: AiCheckId;
  status: AiCheckStatus;
  message: string;
  evidence?: AiCheckResult['evidence'];
  specUrls?: string[];
  fixPrompt?: string;
}

/** Assembles a check result, filling category and weight from the tables. */
export function buildCheck(input: BuildCheckInput): AiCheckResult {
  const { id, status, message } = input;
  return {
    id,
    category: CHECK_CATEGORY[id],
    status,
    message,
    evidence: input.evidence ?? [],
    specUrls: input.specUrls ?? [],
    weight: CHECK_WEIGHTS[id],
    // A fix prompt only makes sense on a check the site can act on.
    ...(status === 'fail' && input.fixPrompt !== undefined ? { fixPrompt: input.fixPrompt } : {}),
  };
}

/**
 * Result for a check that does not apply to this site type. Reported so
 * the visitor sees what was deliberately not tested, but `neutral` keeps
 * it out of the score.
 */
export function notApplicable(id: AiCheckId, specUrls: string[] = []): AiCheckResult {
  return {
    ...buildCheck({
      id,
      status: 'neutral',
      message: 'Non applicable au type de site choisi.',
      specUrls,
    }),
    applicable: false,
  };
}

/** Turns a probe into a single evidence line. */
export function probeEvidence(label: string, res: ProbeResult): AiCheckResult['evidence'][number] {
  return {
    label,
    url: res.url,
    status: res.status,
    ...(res.preview.length > 0 ? { detail: res.preview.slice(0, 240) } : {}),
  };
}
