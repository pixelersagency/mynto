import {
  AI_SITE_TYPE_MAX_LEVEL,
  type AiCheckId,
  type AiCheckResult,
  type AiReadinessResult,
  type AiSiteTypeInput,
} from '@mynto/shared';

import { runBotAccessChecks } from './checks/bots.js';
import { runCommerceChecks } from './checks/commerce.js';
import { runContentChecks } from './checks/content.js';
import { runDiscoverabilityChecks } from './checks/discoverability.js';
import { runProtocolChecks } from './checks/protocols.js';
import { probe } from './probe.js';
import { computeLevel, computeScore } from './scoring.js';
import { APPLICABLE_CHECKS, detectSiteType } from './site-type.js';
import type { AiAuditContext, AiAuditLogger, AiAuditOutcome } from './types.js';

/** Report order. Also the display order on the public report page. */
const CHECK_ORDER: AiCheckId[] = [
  'robots_txt',
  'sitemap',
  'link_headers',
  'dns_aid',
  'markdown_negotiation',
  'llms_txt',
  'no_js_content',
  'ai_bot_rules',
  'content_signals',
  'ai_bot_live_access',
  'web_bot_auth',
  'mcp_server_card',
  'a2a_agent_card',
  'agent_skills',
  'webmcp',
  'api_catalog',
  'oauth_discovery',
  'oauth_protected_resource',
  'auth_md',
  'ard_manifest',
  'x402',
  'mpp',
  'ucp',
  'acp',
];

/**
 * Thrown when no probe of the target origin completed. Separate from a
 * failing check: nothing was measured, so there is no score to publish.
 */
export class SiteUnreachableError extends Error {
  readonly code = 'site_unreachable';

  constructor(reason: string) {
    super(`site_unreachable:${reason}`);
    this.name = 'SiteUnreachableError';
  }
}

/**
 * Runs the "Préparation IA" tests (agent readiness). Fully deterministic:
 * no LLM, no headless browser, only HTTP probes and DNS lookups, so a run
 * lands in ~20s next to the 8-axis audit.
 *
 * The caller is responsible for having validated the URL (SSRF guard) —
 * every probe re-validates each redirect hop anyway.
 */
export async function runAgentReadinessAudit(
  url: string,
  logger: AiAuditLogger,
  siteTypeInput: AiSiteTypeInput = 'auto',
): Promise<AiAuditOutcome> {
  const t0 = Date.now();
  const parsed = new URL(url);
  const origin = parsed.origin;

  const [home, robots] = await Promise.all([
    probe(url, { accept: 'text/html,application/xhtml+xml,*/*', logger }),
    probe(`${origin}/robots.txt`, { accept: 'text/plain,*/*', logger }),
  ]);

  // Both dead means the origin is unreachable from here, not that the site
  // is invisible to agents. Publishing 0/100 in that case tells a site
  // owner their site is broken when ours is: fail the audit instead.
  if (home.status === 'error' && robots.status === 'error') {
    logger.error(
      { url, homeReason: home.errorReason, robotsReason: robots.errorReason },
      'ai_readiness_site_unreachable',
    );
    throw new SiteUnreachableError(home.errorReason ?? robots.errorReason ?? 'unknown');
  }

  const detected = detectSiteType(home);
  const siteType = siteTypeInput === 'auto' ? detected.siteType : siteTypeInput;
  const applicable = APPLICABLE_CHECKS[siteType];

  const ctx: AiAuditContext = {
    targetUrl: url,
    origin,
    host: parsed.hostname,
    home,
    robots,
    siteType,
    siteTypeAuto: siteTypeInput === 'auto',
    siteTypeSignals: siteTypeInput === 'auto' ? detected.signals : [],
    isCommerce: siteType === 'ecommerce',
    applies: (id) => applicable.has(id),
    logger,
  };

  logger.info(
    {
      url,
      homeStatus: home.status,
      robotsStatus: robots.status,
      siteType,
      siteTypeAuto: ctx.siteTypeAuto,
    },
    'ai_readiness_context_ready',
  );

  const groups = await Promise.all([
    runDiscoverabilityChecks(ctx),
    runContentChecks(ctx),
    runBotAccessChecks(ctx),
    runProtocolChecks(ctx),
    runCommerceChecks(ctx),
  ]);

  const checks = sortChecks(groups.flat());
  const score = computeScore(checks);
  const maxLevel = AI_SITE_TYPE_MAX_LEVEL[siteType];
  const { level, levelName } = computeLevel(checks, maxLevel);

  logger.info({ url, score, level, siteType, durationMs: Date.now() - t0 }, 'ai_readiness_done');

  return {
    scannedAt: new Date().toISOString(),
    url,
    score,
    level,
    levelName,
    siteType,
    siteTypeAuto: ctx.siteTypeAuto,
    siteTypeSignals: ctx.siteTypeSignals,
    maxLevel,
    isCommerce: ctx.isCommerce,
    checks,
  };
}

/** Shape stored in `audits_full.ai_readiness` (see AiReadinessResultSchema). */
export function toStoredResult(
  outcome: AiAuditOutcome,
  includedInGlobalScore: boolean,
): AiReadinessResult {
  return {
    version: 1,
    status: 'completed',
    scanned_at: outcome.scannedAt,
    score: outcome.score,
    level: outcome.level,
    level_name: outcome.levelName,
    max_level: outcome.maxLevel,
    site_type: outcome.siteType,
    site_type_auto: outcome.siteTypeAuto,
    site_type_signals: outcome.siteTypeSignals,
    included_in_global_score: includedInGlobalScore,
    error: null,
    checks: outcome.checks,
  };
}

/**
 * Stored shape of a run that measured nothing (origin unreachable from the
 * scanner). No score: a 0 would tell a healthy site it is invisible.
 */
export function failedStoredResult(
  siteTypeInput: AiSiteTypeInput,
  error: string,
  scannedAt: string = new Date().toISOString(),
): AiReadinessResult {
  const siteType = siteTypeInput === 'auto' ? 'vitrine' : siteTypeInput;
  return {
    version: 1,
    status: 'failed',
    scanned_at: scannedAt,
    score: null,
    level: null,
    level_name: null,
    max_level: AI_SITE_TYPE_MAX_LEVEL[siteType],
    site_type: siteType,
    site_type_auto: siteTypeInput === 'auto',
    site_type_signals: [],
    included_in_global_score: false,
    error: error.slice(0, 60),
    checks: [],
  };
}

function sortChecks(checks: AiCheckResult[]): AiCheckResult[] {
  const rank = new Map(CHECK_ORDER.map((id, idx) => [id, idx] as const));
  return [...checks].sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
}

export { computeLevel, computeScore } from './scoring.js';
export type { AiAuditOutcome } from './types.js';

/**
 * Pipeline entry point: never throws. An unreachable origin (or any
 * unexpected error) becomes a `failed` result without score.
 * `included_in_global_score` is decided later by the pipeline.
 */
export async function runAiReadiness(
  url: string,
  logger: AiAuditLogger,
  siteTypeInput: AiSiteTypeInput = 'auto',
): Promise<AiReadinessResult> {
  try {
    return toStoredResult(await runAgentReadinessAudit(url, logger, siteTypeInput), false);
  } catch (err) {
    const code = err instanceof SiteUnreachableError ? err.code : 'ai_readiness_failed';
    logger.warn({ url, code }, 'ai_readiness_failed');
    return failedStoredResult(siteTypeInput, code);
  }
}
