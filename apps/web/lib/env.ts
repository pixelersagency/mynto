import { describeEnvIssues } from '@mynto/shared';
import { z } from 'zod';

const PublicEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
});

const ServerEnvSchema = PublicEnvSchema.extend({
  SCANNER_API_URL: z.string().url().default('http://localhost:4000'),
  // Which proxy headers may be believed when deriving the client IP used
  // for rate limiting. `cloudflare` trusts CF-Connecting-IP; set it only
  // once Cloudflare actually fronts the traffic, otherwise a caller can
  // forge that header and rotate past the per-IP limit.
  CDN_TRUST_MODE: z.enum(['none', 'cloudflare']).default('none'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // PostgreSQL connection string, server-side only (read by @mynto/db via
  // lib/db, which is `server-only`). Optional here so `next build` and the
  // static pages work without a database; every DB read fails soft
  // (error state / 503) when it is missing.
  DATABASE_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith('postgres://') || u.startsWith('postgresql://'), {
      message: 'must be a postgres:// URL',
    })
    .optional(),
  // Media store shared with the scanner (hero screenshots), served by
  // /media/hero/[id].
  MEDIA_DIR: z.string().min(1).default('/data/media'),
  // Audit view tracker : HMAC secret used to hash client IPs before
  // storing them in `audit_views.ip_hash`. Optional: when unset, view
  // tracking still records User-Agent + country, just without a stable
  // visitor identifier (no dedupe).
  AUDIT_VIEWS_IP_HASH_SECRET: z.string().min(16).optional(),

  // Public URL of the install (https://audit.agence.fr). Drives the Secure
  // cookie flag, HSTS and upgrade-insecure-requests, and the links copied
  // from the dashboard. Falls back to NEXT_PUBLIC_APP_URL.
  PUBLIC_URL: z.string().url().optional(),

  // Admin account (one per install). Optional here so the build and the
  // public pages work without it; the login page explains what is missing.
  ADMIN_EMAIL: z.string().trim().email().optional(),
  // scrypt hash from `pnpm admin:hash-password` (preferred).
  ADMIN_PASSWORD_HASH: z.string().startsWith('scrypt:').optional(),
  // Plain password for a quick start only (loud warning at boot).
  ADMIN_PASSWORD: z.string().min(1).optional(),
  // Signs the session cookie (HS256). 32 characters minimum.
  SESSION_SECRET: z.string().min(32).optional(),
  // Sent to the scanner in x-internal-token for audit create / refresh /
  // delete. Same value as the scanner's SCANNER_INTERNAL_TOKEN.
  SCANNER_INTERNAL_TOKEN: z.string().min(32).optional(),

  // 32 random bytes (base64 or hex) encrypting the AI provider keys saved in
  // Réglages > IA (AES-256-GCM). Same value as the scanner. Unset = keys
  // cannot be saved from the dashboard. Generate: openssl rand -base64 32
  APP_ENCRYPTION_KEY: z.string().min(32).optional(),
  // Optional env fallbacks, only used by "Tester la connexion" when no key
  // is stored (the scanner reads its own env for audits).
  ANTHROPIC_API_KEY: z.string().min(8).optional(),
  GEMINI_API_KEY: z.string().min(8).optional(),
  MISTRAL_API_KEY: z.string().min(8).optional(),
  AUDIT_LLM_PROVIDER: z.enum(['gemini', 'mistral', 'anthropic']).optional(),
  AUDIT_LLM_MODEL: z.string().optional(),
  VISION_LLM_PROVIDER: z.enum(['gemini', 'anthropic']).optional(),
  VISION_LLM_MODEL: z.string().optional(),
  // Outgoing webhooks may target private addresses and plain http (a
  // self-hosted n8n on the same network). Same value as the scanner, which
  // enforces it at send time. See docs/webhooks.md for the risks.
  WEBHOOKS_ALLOW_PRIVATE: z
    .union([z.literal('1'), z.literal('0'), z.literal('true'), z.literal('false')])
    .transform((v) => v === '1' || v === 'true')
    .default('0'),
  // Redis of the scanner (BullMQ). Optional for the web app: when set, the
  // API / MCP rate limit is shared by every web process through it;
  // unset, the limit is kept in memory per process.
  REDIS_URL: z.string().url().startsWith('redis').optional(),
  // Requests per minute per API key on /api/v1 and /mcp.
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).max(10_000).default(120),

  // Agency branding defaults, used until the "Marque" settings are saved.
  AGENCY_NAME: z.string().trim().min(1).max(80).default('Mon agence'),
  AGENCY_WEBSITE_URL: z.string().url().optional(),
  AGENCY_CONTACT_URL: z.string().min(1).optional(),
  AGENCY_PRIMARY_COLOR: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  AGENCY_REPORT_FOOTER: z.string().max(500).optional(),
});

export type PublicEnv = z.infer<typeof PublicEnvSchema>;
export type ServerEnv = z.infer<typeof ServerEnvSchema>;

let serverEnvCache: ServerEnv | null = null;

/** An empty value left in .env (`GEMINI_API_KEY=`) means "not set". */
function withoutEmptyValues(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && v.trim() !== '') out[k] = v;
  return out;
}

export function getServerEnv(): ServerEnv {
  if (serverEnvCache !== null) return serverEnvCache;
  const env = withoutEmptyValues(process.env);
  const parsed = ServerEnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = describeEnvIssues(parsed.error.issues, env).join('\n');
    throw new Error(`Configuration invalide :\n${issues}`);
  }
  serverEnvCache = parsed.data;
  return parsed.data;
}

/** Public URL of the install, without trailing slash. */
export function publicUrl(): string {
  const env = getServerEnv();
  return (env.PUBLIC_URL ?? env.NEXT_PUBLIC_APP_URL).replace(/\/+$/, '');
}

/** True when the install is served over HTTPS (Secure cookie, HSTS). */
export function isHttpsInstall(): boolean {
  return publicUrl().startsWith('https://');
}

export interface EnvCheck {
  /** Blocking problems: the server refuses to start in production. */
  errors: string[];
  /** Features that stay off until the variable is set. */
  warnings: string[];
}

/**
 * Boot check of the web app (instrumentation.ts), in French, variable names
 * only (never a value). Invalid values are always errors; in production a
 * missing variable the install cannot work without is an error too.
 */
export function checkServerEnv(
  rawEnv: Record<string, string | undefined>,
  production: boolean,
): EnvCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const env: Record<string, string | undefined> = withoutEmptyValues(rawEnv);
  const parsed = ServerEnvSchema.safeParse(env);
  if (!parsed.success) errors.push(...describeEnvIssues(parsed.error.issues, env));

  const has = (k: string): boolean => env[k] !== undefined && env[k] !== '';
  const required = ['DATABASE_URL', 'ADMIN_EMAIL', 'SESSION_SECRET', 'SCANNER_INTERNAL_TOKEN'];
  const missing = required.filter((k) => !has(k));
  if (!has('ADMIN_PASSWORD_HASH') && !has('ADMIN_PASSWORD')) missing.push('ADMIN_PASSWORD_HASH');
  for (const k of missing) {
    const line = `  - ${k} : manquante (obligatoire)`;
    if (errors.includes(line)) continue;
    (production ? errors : warnings).push(line);
  }
  if (!has('PUBLIC_URL') && !has('NEXT_PUBLIC_APP_URL')) {
    warnings.push(
      '  - PUBLIC_URL : non définie, les liens copiés pointeront vers http://localhost:3000',
    );
  }
  if (!has('APP_ENCRYPTION_KEY')) {
    warnings.push(
      '  - APP_ENCRYPTION_KEY : non définie, impossible d’enregistrer clés IA, mot de passe SMTP et webhooks',
    );
  }
  return { errors, warnings };
}

export function getPublicEnv(): PublicEnv {
  return {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  };
}
