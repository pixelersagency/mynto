import { describeEnvIssues } from '@mynto/shared';
import { z } from 'zod';

const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  // PostgreSQL connection string (postgres://user:pass@host:5432/db).
  DATABASE_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith('postgres://') || u.startsWith('postgresql://'), {
      message: 'must be a postgres:// URL',
    }),
  // Apply pending migrations (packages/db/migrations) at boot. Turn off when
  // migrations are run separately (`pnpm db:migrate`).
  DB_MIGRATE_ON_START: z
    .union([z.boolean(), z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .transform((v) => v === true || v === '1' || v === 'true')
    .default(true),
  // Media store root, shared with the web app (hero screenshots).
  MEDIA_DIR: z.string().min(1).default('/data/media'),

  REDIS_URL: z.string().url().startsWith('redis'),

  // Name resolution of the SSRF guard (and of the address pinned to the
  // socket): `system` (default) or `doh` (DNS-over-HTTPS, Cloudflare then
  // Google). Use doh when the host's DNS is filtered or proxied. The
  // private / reserved IP blocklist applies to DoH answers too.
  // (Read again by lib/dns-resolver.ts straight from process.env.)
  SCANNER_DNS_RESOLVER: z.enum(['system', 'doh']).default('system'),
  // Hard deadline of the graceful shutdown (SIGTERM / SIGINT), then the
  // process exits on its own. Keep it under the orchestrator's grace period
  // (docker compose: 10 s by default, 15 s in our docker-compose.yml).
  SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(8_000),

  // Chiffrage du temps de correction. The audit costs the deterministic
  // findings in dev time at the agency's daily rate. Indicative only, never
  // a firm quote.
  AUDIT_DAILY_RATE_EUR: z.coerce.number().int().min(0).max(10000).default(500),
  AUDIT_BILLABLE_HOURS_PER_DAY: z.coerce.number().min(1).max(24).default(7),

  // Cap on POST /api/audits/full per caller IP (the web app, behind the
  // internal token), i.e. audits the admin can launch per hour.
  RATE_LIMIT_AUDITS_PER_IP_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(60),

  // x-admin-token for /api/admin/queue-stats and /health?outbound=1.
  ADMIN_TOKEN: z.string().min(16),

  // Base URL the scanner uses to reach the web app (PDF export prints the
  // report page). Can be an internal URL (http://web:3000).
  WEB_BASE_URL: z.string().url().default('http://localhost:3000'),
  // Public URL of the install, as prospects see it. Used for the /r/<token>
  // links returned by the APIs and in the bot User-Agent. Falls back to
  // WEB_BASE_URL.
  PUBLIC_URL: z.string().url().optional(),
  // Shared secret the web app sends in `x-internal-token` to create, refresh
  // and delete audits. Unset = those routes answer 503 (never open).
  SCANNER_INTERNAL_TOKEN: z.string().min(32).optional(),
  // Full User-Agent override of the audit bot (default
  // "Mozilla/5.0 (compatible; MyntoAudit/<version>; +<PUBLIC_URL>)").
  AUDIT_USER_AGENT: z.string().min(1).max(300).optional(),

  MISTRAL_API_KEY: z.string().min(8).optional(),

  // 32 random bytes (base64 or hex) that encrypt the AI provider keys saved
  // from the dashboard (Réglages > IA). Same value as the web app. Unset =
  // only the env keys below are used. Generate: openssl rand -base64 32
  APP_ENCRYPTION_KEY: z.string().min(32).optional(),
  // How long the scanner caches the AI settings read from the database.
  AI_CONFIG_CACHE_MS: z.coerce.number().int().min(0).max(600_000).default(30_000),

  // Narrative provider. Claude by default; without the matching API key the
  // report keeps its deterministic narrative (no LLM call is made).
  AUDIT_LLM_PROVIDER: z.enum(['gemini', 'mistral', 'anthropic']).default('anthropic'),
  AUDIT_LLM_MODEL: z.string().optional(),
  GEMINI_API_KEY: z.string().min(8).optional(),
  ANTHROPIC_API_KEY: z.string().min(8).optional(),
  // Provider for the screenshot (vision) analysis. Anthropic uses
  // ANTHROPIC_API_KEY and defaults to claude-haiku-5-5. Skipped without key.
  VISION_LLM_PROVIDER: z.enum(['gemini', 'anthropic']).default('anthropic'),
  VISION_LLM_MODEL: z.string().optional(),
  // Daily hard cap on vision LLM calls across the whole worker fleet.
  // Stops a quota-exhaustion attack that spams audit creation. Counter
  // lives in Redis under `vision:calls:YYYY-MM-DD`. Default 500/day
  // ~= $0.25/day max billed Gemini cost.
  VISION_DAILY_QUOTA: z.coerce.number().int().min(0).max(100_000).default(500),

  // Radar (prospection B2B). Bearer key Radar sends on /api/radar/audits*.
  // Optional: when unset, every authenticated /api/radar/* route answers
  // 503 so a half-configured deploy never exposes an open endpoint.
  RADAR_API_KEY: z.string().min(24).optional(),
  // Max NEW scans per Paris calendar day for the Radar key. Cache hits and
  // idempotent repeats are free. Counter in Redis `radar:quota:YYYY-MM-DD`.
  RADAR_DAILY_AUDIT_QUOTA: z.coerce.number().int().min(0).max(1000).default(20),
  // Radar "audit_viewed" webhook. Both must be set: at boot they become a
  // webhook endpoint flagged "format Radar historique" (docs/webhooks.md).
  // Unset = that endpoint is switched off; views are still counted.
  RADAR_WEBHOOK_URL: z.string().url().startsWith('https://').optional(),
  RADAR_WEBHOOK_SECRET: z.string().min(24).optional(),
  // Outgoing webhooks: allow private / loopback targets and plain http (a
  // self-hosted n8n on the same network). Off by default (SSRF protection).
  // See docs/webhooks.md before turning it on.
  WEBHOOKS_ALLOW_PRIVATE: z
    .union([z.boolean(), z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .transform((v) => v === true || v === '1' || v === 'true')
    .default(false),
  // HMAC secret for ip/session hashes in radar_audit_views. Same secret as
  // the web app's audit_views tracker. When unset, the session id is hashed
  // with unkeyed SHA-256 and no ip_hash is stored (no IP-based dedupe).
  AUDIT_VIEWS_IP_HASH_SECRET: z.string().min(16).optional(),

  // Heavy collectors. ON by default. The runtime audit load is 2-3
  // concurrent max on an 8 GB worker, which comfortably handles the
  // peak RAM (~1.2 GB combined Chrome instances). Set to 0 / false in
  // a constrained dev env if needed ; production wants both enabled
  // because the rules backed by these collectors (perf.lcp.slow,
  // perf.cls.high, perf.tbt.high, perf.byte_weight.heavy,
  // perf.lighthouse.low, a11y.lighthouse.low) would otherwise show as
  // "Non exécutés" on every report.
  AUDIT_RUN_LIGHTHOUSE: z
    .union([z.boolean(), z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .transform((v) => v === true || v === '1' || v === 'true')
    .default(true),
  AUDIT_RUN_AXE: z
    .union([z.boolean(), z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .transform((v) => v === true || v === '1' || v === 'true')
    .default(true),

  ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:3000')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter((o) => o.length > 0),
    ),
});

export type Config = z.infer<typeof ConfigSchema>;

/**
 * An empty value (`ANTHROPIC_API_KEY=` left in .env) means "not set", not
 * "set to an empty string": otherwise every optional variable with a
 * minimum length would fail the validation.
 */
export function withoutEmptyValues(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v.trim() !== '') out[k] = v;
  return out;
}

function loadConfig(): Config {
  const parsed = ConfigSchema.safeParse(withoutEmptyValues(process.env));
  if (!parsed.success) {
    const lines = describeEnvIssues(parsed.error.issues, process.env).join('\n');
    // Printed as is (no JSON log): this is what someone reads in
    // `docker compose logs scanner` when the install does not start.
    process.stderr.write(
      `\n[mynto scanner] Configuration invalide, le scanner ne démarre pas :\n${lines}\n` +
        'Voir .env.example (chaque variable y est documentée).\n\n',
    );
    // No stack trace for a configuration problem; tests get an exception.
    if (process.env.VITEST === undefined) process.exit(1);
    throw new Error('Configuration invalide (voir le détail ci-dessus)');
  }
  return parsed.data;
}

export const config = loadConfig();

/** Public base URL for links handed out (/r/<token>). */
export function publicBaseUrl(): string {
  return config.PUBLIC_URL ?? config.WEB_BASE_URL;
}
