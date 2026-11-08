import { createHmac, randomBytes } from 'node:crypto';

import { userAgentFamily } from '@mynto/shared';

import { trustedClientIp } from './client-ip';
import { db, pgErrorCode } from './db';
import { getServerEnv } from './env';
import { logger } from './logger';

/**
 * Server-side view tracker for public audit reports (/audit/full/<slug>).
 *
 * Same CNIL-simplified policy as the tracking links (docs/radar.md):
 *   - no country, no raw User-Agent: only a coarse browser family
 *     ("Chrome, mobile", see userAgentFamily);
 *   - the IP is never stored. Its HMAC (AUDIT_VIEWS_IP_HASH_SECRET, or a
 *     random per-process secret when unset) only serves the 30-minute
 *     dedupe;
 *   - nothing is read from or written to the visitor's browser.
 *
 * Why server-side: LLM crawlers do not run JavaScript; recording on the SSR
 * pass counts them with the same code path. The admin's own visits (session
 * cookie or ?preview=1) are not counted: the caller skips them.
 */

const DEDUPE_WINDOW_MS = 30 * 60 * 1000;

let processSecret: string | null = null;
function hashSecret(): string {
  const configured = getServerEnv().AUDIT_VIEWS_IP_HASH_SECRET;
  if (configured) return configured;
  processSecret ??= randomBytes(32).toString('hex');
  return processSecret;
}

function hashIp(ip: string, secret: string): string {
  return createHmac('sha256', secret).update(ip).digest('hex');
}

export interface RecordViewInput {
  /** audits_full.slug — we look up the id internally. */
  slug: string;
  headers: Headers;
}

export type RecordViewResult = 'recorded' | 'deduped' | 'failed' | 'not_found';

/**
 * Records one view of the given audit. Best-effort: errors are logged but
 * never thrown, so a failure here cannot break the audit report render.
 */
export async function recordAuditView(input: RecordViewInput): Promise<RecordViewResult> {
  let auditId: string | null;
  try {
    auditId = await db().audits.getIdBySlug(input.slug);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'audit_views_audit_lookup_failed');
    return 'failed';
  }
  if (!auditId) return 'not_found';

  const ip = trustedClientIp(input.headers);
  const ipHash = ip ? hashIp(ip, hashSecret()) : null;
  const family = userAgentFamily(input.headers.get('user-agent'));

  if (ipHash !== null) {
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
    try {
      if (await db().views.hasRecentView(auditId, ipHash, since)) return 'deduped';
    } catch (err) {
      logger.error({ code: pgErrorCode(err) }, 'audit_views_dedupe_lookup_failed');
    }
  }

  try {
    await db().views.insert({ auditId, userAgentFamily: family, ipHash });
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'audit_views_insert_failed');
    return 'failed';
  }
  return 'recorded';
}

// ---------------------------------------------------------------------------
// User-Agent classification (humans vs LLM crawlers vs traditional bots)
// ---------------------------------------------------------------------------

/**
 * Lightweight bot category for dashboard analytics. Order matters: the first
 * matching pattern wins, and `ai_crawler` takes precedence over `search_bot`
 * when a UA matches both (e.g. Google-Extended).
 */
export type ViewerCategory = 'ai_crawler' | 'search_bot' | 'social_bot' | 'monitor' | 'human';

const AI_CRAWLER_PATTERNS = [
  /GPTBot/i,
  /OAI-SearchBot/i,
  /ChatGPT-User/i,
  /ClaudeBot/i,
  /anthropic-ai/i,
  /Claude-Web/i,
  /PerplexityBot/i,
  /Perplexity-User/i,
  /Google-Extended/i,
  /Applebot-Extended/i,
  /CCBot/i,
  /Bytespider/i,
  /Meta-ExternalAgent/i,
  /cohere-ai/i,
];

const SEARCH_BOT_PATTERNS = [
  /Googlebot/i,
  /bingbot/i,
  /Slurp/i,
  /DuckDuckBot/i,
  /Baiduspider/i,
  /YandexBot/i,
  /Applebot/i, // distinct from Applebot-Extended
];

const SOCIAL_BOT_PATTERNS = [
  /facebookexternalhit/i,
  /LinkedInBot/i,
  /Twitterbot/i,
  /Slackbot/i,
  /WhatsApp/i,
  /TelegramBot/i,
  /Discordbot/i,
];

const MONITOR_PATTERNS = [
  /UptimeRobot/i,
  /Pingdom/i,
  /StatusCake/i,
  /HetrixTools/i,
  /headlesschrome/i, // Lighthouse / synthetic monitors
];

export function classifyUserAgent(userAgent: string | null | undefined): ViewerCategory {
  if (!userAgent || userAgent.length === 0) return 'human';
  for (const re of AI_CRAWLER_PATTERNS) if (re.test(userAgent)) return 'ai_crawler';
  for (const re of SEARCH_BOT_PATTERNS) if (re.test(userAgent)) return 'search_bot';
  for (const re of SOCIAL_BOT_PATTERNS) if (re.test(userAgent)) return 'social_bot';
  for (const re of MONITOR_PATTERNS) if (re.test(userAgent)) return 'monitor';
  return 'human';
}
