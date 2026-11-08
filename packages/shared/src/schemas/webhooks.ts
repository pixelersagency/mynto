import { z } from 'zod';

/**
 * Outgoing webhooks (docs/webhooks.md): event types, delivery policy,
 * payload builders and the API / MCP shapes. Pure (no Node API): used by the
 * database layer (outbox), the scanner dispatcher, the web app and the MCP
 * tools.
 *
 * Payloads never carry the visitor IP, fingerprint or user agent, the audit
 * contact email or the LLM inputs. Only email.* events carry an address: the
 * recipient typed by the agency itself.
 */

/** Types an endpoint can subscribe to. */
export const WEBHOOK_EVENT_TYPES = [
  'audit.created',
  'audit.completed',
  'audit.failed',
  'audit.refreshed',
  'audit.deleted',
  'link.first_opened',
  'link.opened',
  'email.sent',
  'email.failed',
] as const;
export type WebhookSubscribableEvent = (typeof WEBHOOK_EVENT_TYPES)[number];
/** Every type, including the on-demand test event. */
export type WebhookEventType = WebhookSubscribableEvent | 'ping';

export const WebhookEventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);

/** French labels of the dashboard. */
export const WEBHOOK_EVENT_LABEL: Record<WebhookEventType, string> = {
  'audit.created': 'Audit lancé',
  'audit.completed': 'Audit terminé',
  'audit.failed': 'Audit en échec',
  'audit.refreshed': 'Audit rafraîchi',
  'audit.deleted': 'Audit supprimé',
  'link.first_opened': 'Première ouverture du lien',
  'link.opened': 'Ouverture du lien',
  'email.sent': 'Rapport envoyé par email',
  'email.failed': 'Envoi par email en échec',
  ping: 'Ping de test',
};

/** Version of the payload contract, sent as `api_version`. */
export const WEBHOOK_API_VERSION = '2026-11-01';

// ---------------------------------------------------------------------------
// Delivery policy
// ---------------------------------------------------------------------------

/** Attempts per delivery, the first one included. */
export const WEBHOOK_MAX_ATTEMPTS = 6;
/** Delay before attempt n+1 after attempt n failed (n = 1..5): 1 min, 5 min, 30 min, 2 h, 6 h. */
export const WEBHOOK_BACKOFF_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000] as const;
/** Final failures in a row after which an endpoint is switched off. */
export const WEBHOOK_AUTO_DISABLE_AFTER = 20;
/** HTTP timeout of one attempt. */
export const WEBHOOK_TIMEOUT_MS = 10_000;
/** Bytes of the receiver's answer kept in the delivery log. */
export const WEBHOOK_RESPONSE_MAX = 2048;
/** Days the delivery log is kept. */
export const WEBHOOK_LOG_DAYS = 30;
/** Signature tolerance documented for receivers. */
export const WEBHOOK_REPLAY_TOLERANCE_S = 300;

/**
 * Delay before the next attempt once attempt `failedAttempt` (1-based)
 * failed, or null when it was the last one.
 */
export function webhookBackoffMs(failedAttempt: number): number | null {
  if (!Number.isInteger(failedAttempt) || failedAttempt < 1) return null;
  if (failedAttempt >= WEBHOOK_MAX_ATTEMPTS) return null;
  return WEBHOOK_BACKOFF_MS[failedAttempt - 1] ?? null;
}

/**
 * Whether a failed attempt is worth retrying.
 *   - network errors and timeouts: yes;
 *   - legacy Radar format: only 5xx and 429 (Radar answers 401 on a bad
 *     signature and 404 on an unknown token, a retry changes nothing);
 *   - standard format: any non-2xx except 410 Gone (an n8n workflow that is
 *     switched off answers 404 for a while, a retry helps).
 * A refused redirect or a blocked target is a configuration error: final.
 */
export function isRetryableWebhookFailure(input: {
  statusCode: number | null;
  error: string | null;
  legacy: boolean;
}): boolean {
  if (input.statusCode === null) {
    return input.error === 'timeout' || input.error === 'network_error';
  }
  const s = input.statusCode;
  if (s >= 300 && s < 400) return false;
  if (input.legacy) return s >= 500 || s === 429;
  return s !== 410;
}

// ---------------------------------------------------------------------------
// Snapshot (stored in the outbox) and payload
// ---------------------------------------------------------------------------

/** Audit as captured at the time of the event (database row, 0-10 score). */
export interface WebhookAuditSnapshot {
  id: string;
  slug: string;
  url: string;
  label: string | null;
  status: string;
  source: string;
  global_score: number | null;
  ai_score: number | null;
  /** Scan replaced by this one (audit.refreshed). */
  previous_id: string | null;
}

export interface WebhookLinkSnapshot {
  id: string;
  /** Bearer secret of /r/<token>: only rendered into link.url (and the legacy body). */
  token: string;
  external_ref: string | null;
  views_count: number;
  first_opened_at: string | null;
}

export interface WebhookEmailSnapshot {
  recipient: string;
  subject: string;
  status: 'sent' | 'failed';
  error_code: string | null;
}

export interface WebhookSnapshot {
  occurred_at: string;
  audit?: WebhookAuditSnapshot | null;
  link?: WebhookLinkSnapshot | null;
  email?: WebhookEmailSnapshot | null;
  endpoint_id?: string | null;
}

export interface WebhookPayloadAudit {
  id: string;
  slug: string;
  url: string;
  label: string | null;
  /** Score /100 over the evaluated axes, null until completed. */
  score: number | null;
  /** Préparation IA score /100, only when the module ran. */
  ai_score?: number;
  status: string;
  source: string;
  previous_id?: string;
}

export interface WebhookPayloadLink {
  id: string;
  url: string;
  external_ref: string | null;
  views_count: number;
  first_opened_at: string | null;
}

export interface WebhookPayload {
  id: string;
  type: WebhookEventType;
  created_at: string;
  api_version: string;
  data: {
    audit?: WebhookPayloadAudit | null;
    link?: WebhookPayloadLink | null;
    report_url?: string | null;
    email?: {
      recipient: string;
      subject: string;
      status: 'sent' | 'failed';
      error_code: string | null;
    };
    message?: string;
    endpoint_id?: string;
  };
}

function score100(v: number | null): number | null {
  return typeof v === 'number' && Number.isFinite(v)
    ? Math.max(0, Math.min(100, Math.round(v * 10)))
    : null;
}

/** Public report URL: tracking link for Radar audits, direct report otherwise (same rule as the API). */
export function webhookReportUrl(
  base: string,
  audit: WebhookAuditSnapshot,
  link: WebhookLinkSnapshot | null | undefined,
): string {
  const root = base.replace(/\/+$/, '');
  if (audit.source === 'radar' && link) return `${root}/r/${link.token}`;
  return `${root}/audit/full/${audit.slug}`;
}

function payloadAudit(a: WebhookAuditSnapshot): WebhookPayloadAudit {
  const completed = a.status === 'completed';
  return {
    id: a.id,
    slug: a.slug,
    url: a.url,
    label: a.label,
    score: completed ? score100(a.global_score) : null,
    ...(a.ai_score !== null && completed ? { ai_score: a.ai_score } : {}),
    status: a.status,
    source: a.source,
    ...(a.previous_id !== null ? { previous_id: a.previous_id } : {}),
  };
}

/** Builds the standard payload of an event. Pure (tested). */
export function buildWebhookPayload(
  event: { id: string; type: WebhookEventType; created_at: string; snapshot: WebhookSnapshot },
  baseUrl: string,
): WebhookPayload {
  const root = baseUrl.replace(/\/+$/, '');
  const s = event.snapshot;
  const data: WebhookPayload['data'] = {};
  if (event.type === 'ping') {
    data.message = 'Ping de test envoyé depuis mynto.';
    if (s.endpoint_id) data.endpoint_id = s.endpoint_id;
  } else {
    const audit = s.audit ?? null;
    const link = s.link ?? null;
    data.audit = audit === null ? null : payloadAudit(audit);
    data.link =
      link === null
        ? null
        : {
            id: link.id,
            url: `${root}/r/${link.token}`,
            external_ref: link.external_ref,
            views_count: link.views_count,
            first_opened_at: link.first_opened_at,
          };
    data.report_url =
      audit === null || event.type === 'audit.deleted' ? null : webhookReportUrl(root, audit, link);
    if ((event.type === 'email.sent' || event.type === 'email.failed') && s.email) {
      data.email = {
        recipient: s.email.recipient,
        subject: s.email.subject,
        status: s.email.status,
        error_code: s.email.error_code,
      };
    }
  }
  return {
    id: event.id,
    type: event.type,
    created_at: event.created_at,
    api_version: WEBHOOK_API_VERSION,
    data,
  };
}

/**
 * Body of the historical Radar contract ("audit_viewed"), key order and
 * values byte-identical to the former dedicated queue. Null when the event
 * is not a link opening.
 */
export function buildLegacyRadarBody(
  type: WebhookEventType,
  snapshot: WebhookSnapshot,
): string | null {
  if (type !== 'link.opened' || !snapshot.link) return null;
  return JSON.stringify({
    tracking_token: snapshot.link.token,
    event: 'audit_viewed',
    occurred_at: snapshot.occurred_at,
    // Deprecated since the CNIL-friendly beacon, kept for the contract.
    duration_s: 0,
    sections_viewed: [],
  });
}

// ---------------------------------------------------------------------------
// Target URL (syntax only; the scanner resolves and pins the address)
// ---------------------------------------------------------------------------

function privateIpv4Literal(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function privateIpv6Literal(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === '::' ||
    h === '::1' ||
    h.startsWith('fc') ||
    h.startsWith('fd') ||
    h.startsWith('fe80') ||
    h.startsWith('::ffff:')
  );
}

export type WebhookUrlProblem =
  | 'invalid_url'
  | 'https_required'
  | 'credentials_in_url'
  | 'private_target';

export const WEBHOOK_URL_PROBLEM_MESSAGE: Record<WebhookUrlProblem, string> = {
  invalid_url: 'Adresse invalide. Exemple : https://n8n.agence.fr/webhook/mynto',
  https_required: 'L’adresse doit commencer par https://.',
  credentials_in_url: 'Retire l’identifiant et le mot de passe de l’adresse.',
  private_target:
    'Cette adresse vise un réseau privé. Active WEBHOOKS_ALLOW_PRIVATE=1 pour l’autoriser.',
};

/**
 * Syntax check of a webhook target, no DNS. HTTPS only and no private,
 * loopback or link-local literal unless `allowPrivate` (then http is
 * accepted too). The scanner repeats the check on the resolved address at
 * every attempt.
 */
export function webhookUrlProblem(raw: string, allowPrivate: boolean): WebhookUrlProblem | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return 'invalid_url';
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'invalid_url';
  if (u.hostname === '') return 'invalid_url';
  if (u.username !== '' || u.password !== '') return 'credentials_in_url';
  if (allowPrivate) return null;
  if (u.protocol !== 'https:') return 'https_required';
  let host = u.hostname.toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    (!host.includes('.') && !host.includes(':'))
  ) {
    return 'private_target';
  }
  if (privateIpv4Literal(host) || (host.includes(':') && privateIpv6Literal(host))) {
    return 'private_target';
  }
  return null;
}

// ---------------------------------------------------------------------------
// API v1 and MCP
// ---------------------------------------------------------------------------

const eventsList = z
  .array(WebhookEventTypeSchema)
  .min(1, 'Choisis au moins un événement.')
  .max(WEBHOOK_EVENT_TYPES.length)
  .transform((a) => [...new Set(a)]);

export const ApiWebhookCreateBodySchema = z
  .object({
    url: z
      .string()
      .trim()
      .min(1)
      .max(2048)
      .describe('HTTPS address that receives the POST requests.'),
    events: eventsList.describe(`Event types to receive: ${WEBHOOK_EVENT_TYPES.join(', ')}.`),
    description: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .optional()
      .describe('Free note, e.g. the tool behind the URL.'),
    active: z.boolean().optional().describe('Default true.'),
  })
  .strict();
export type ApiWebhookCreateBody = z.infer<typeof ApiWebhookCreateBodySchema>;

export const ApiWebhookUpdateBodySchema = z
  .object({
    url: z.string().trim().min(1).max(2048).optional(),
    events: eventsList.optional(),
    description: z.string().trim().max(120).nullable().optional(),
    active: z.boolean().optional(),
    legacy_radar_format: z.boolean().optional(),
  })
  .strict();
export type ApiWebhookUpdateBody = z.infer<typeof ApiWebhookUpdateBodySchema>;

export interface ApiWebhook {
  id: string;
  url: string;
  description: string | null;
  events: WebhookSubscribableEvent[];
  active: boolean;
  /** Historical Radar body for link.opened ("audit_viewed"). */
  legacy_radar_format: boolean;
  /** URL and secret come from the environment (RADAR_WEBHOOK_URL / RADAR_WEBHOOK_SECRET). */
  managed_by_env: boolean;
  secret_hint: string | null;
  consecutive_failures: number;
  disabled_at: string | null;
  disabled_reason: 'auto' | 'env_removed' | null;
  last_status: 'success' | 'failed' | null;
  last_status_code: number | null;
  last_delivery_at: string | null;
  created_at: string;
}

export interface ApiWebhookWithSecret extends ApiWebhook {
  /** Shown once: store it on the receiving side. */
  secret: string;
}

export interface ApiWebhookAttempt {
  attempt: number;
  status_code: number | null;
  error: string | null;
  duration_ms: number;
  response_body: string | null;
  created_at: string;
}

export interface ApiWebhookDelivery {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: WebhookEventType;
  format: 'standard' | 'legacy_radar';
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  next_attempt_at: string | null;
  last_status_code: number | null;
  last_duration_ms: number | null;
  last_error: string | null;
  manual: boolean;
  created_at: string;
  completed_at: string | null;
  request_body?: string;
  attempts_log?: ApiWebhookAttempt[];
}

export interface ApiWebhookTestResult {
  event_id: string;
  status: 'queued';
}

export const ApiWebhookDeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
  status: z.enum(['pending', 'success', 'failed']).optional(),
});
export type ApiWebhookDeliveriesQuery = z.infer<typeof ApiWebhookDeliveriesQuerySchema>;
