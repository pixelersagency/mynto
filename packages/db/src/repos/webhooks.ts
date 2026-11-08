import { randomBytes, randomUUID } from 'node:crypto';

import {
  WEBHOOK_AUTO_DISABLE_AFTER,
  WEBHOOK_LOG_DAYS,
  buildLegacyRadarBody,
  buildWebhookPayload,
  webhookBackoffMs,
  type WebhookAuditSnapshot,
  type WebhookEmailSnapshot,
  type WebhookEventType,
  type WebhookLinkSnapshot,
  type WebhookSnapshot,
  type WebhookSubscribableEvent,
} from '@mynto/shared';

import { jsonb, type Queryable, type Sql } from '../client.js';

/**
 * Outgoing webhooks: endpoints, outbox, deliveries and their log.
 *
 * Outbox: `emitWebhookEvent(tx, ...)` is called inside the transaction that
 * changes the state (audit created, finished, deleted, link opened, email
 * logged), so an event exists if and only if the change was committed. The
 * scanner dispatcher then fans each event out to the subscribed endpoints
 * (`fanOut`), and delivers through BullMQ (`claim` + `recordAttempt`), with
 * the database as the source of truth of what is left to send.
 *
 * Secrets reach this repository already encrypted (APP_ENCRYPTION_KEY,
 * AAD `webhook:<id>`) and are only read back by the dispatcher.
 */

export const WEBHOOK_SECRET_PREFIX = 'whsec_';

/** New signing secret: "whsec_" + 32 random bytes, base64url. */
export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

/** AAD of the secret ciphertext: a ciphertext copied to another row fails to decrypt. */
export function webhookSecretAad(endpointId: string): string {
  return `webhook:${endpointId}`;
}

export function newWebhookEventId(): string {
  return `evt_${randomBytes(12).toString('hex')}`;
}

export interface WebhookEndpointRow {
  id: string;
  url: string;
  description: string | null;
  events: WebhookSubscribableEvent[];
  active: boolean;
  secret_hint: string | null;
  legacy_radar_format: boolean;
  system_key: string | null;
  consecutive_failures: number;
  disabled_at: string | null;
  disabled_reason: 'auto' | 'env_removed' | null;
  last_status: 'success' | 'failed' | null;
  last_status_code: number | null;
  last_delivery_at: string | null;
  created_at: string;
  updated_at: string;
}

const ENDPOINT_COLUMNS = [
  'id',
  'url',
  'description',
  'events',
  'active',
  'secret_hint',
  'legacy_radar_format',
  'system_key',
  'consecutive_failures',
  'disabled_at',
  'disabled_reason',
  'last_status',
  'last_status_code',
  'last_delivery_at',
  'created_at',
  'updated_at',
] as const;

export interface WebhookDeliveryRow {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: WebhookEventType;
  format: 'standard' | 'legacy_radar';
  status: 'pending' | 'success' | 'failed';
  attempts: number;
  next_attempt_at: string;
  last_status_code: number | null;
  last_duration_ms: number | null;
  last_error: string | null;
  manual: boolean;
  created_at: string;
  completed_at: string | null;
}

export interface WebhookAttemptRow {
  attempt: number;
  status_code: number | null;
  error: string | null;
  duration_ms: number;
  response_body: string | null;
  created_at: string;
}

export interface WebhookDeliveryDetail extends WebhookDeliveryRow {
  request_body: string;
  attempts_log: WebhookAttemptRow[];
}

/** What the dispatcher needs to send one attempt. */
export interface ClaimedDelivery {
  id: string;
  attempt: number;
  event_id: string;
  event_type: WebhookEventType;
  format: 'standard' | 'legacy_radar';
  request_body: string;
  endpoint_id: string;
  endpoint_url: string;
  endpoint_active: boolean;
  secret_ciphertext: string | null;
  system_key: string | null;
}

export interface AttemptResult {
  statusCode: number | null;
  error: string | null;
  durationMs: number;
  responseBody: string | null;
  ok: boolean;
  retryable: boolean;
}

export type AttemptOutcome =
  | { kind: 'success' }
  | { kind: 'retry'; nextAttempt: number; delayMs: number }
  | { kind: 'failed'; endpointDisabled: boolean };

export type EmitInput =
  | {
      type:
        | 'audit.created'
        | 'audit.completed'
        | 'audit.failed'
        | 'audit.refreshed'
        | 'audit.deleted';
      auditId: string;
    }
  | { type: 'link.opened' | 'link.first_opened'; linkId: string; occurredAt: string }
  | { type: 'email.sent' | 'email.failed'; auditId: string; email: WebhookEmailSnapshot }
  | { type: 'ping'; endpointId: string };

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

async function auditSnapshot(db: Queryable, auditId: string): Promise<WebhookAuditSnapshot | null> {
  const [a] = await db<WebhookAuditSnapshot[]>`
    select a.id, a.slug, a.url, a.label, a.status, a.source,
           a.global_score::float8 as global_score, a.ai_score::int as ai_score,
           (select p.id from audits_full p where p.replaced_by = a.id
             order by p.created_at desc limit 1) as previous_id
      from audits_full a where a.id = ${auditId}
  `;
  return a ?? null;
}

async function linkSnapshot(
  db: Queryable,
  where: { linkId: string } | { auditId: string },
): Promise<(WebhookLinkSnapshot & { audit_id: string }) | null> {
  const filter = 'linkId' in where ? db`r.id = ${where.linkId}` : db`r.audit_id = ${where.auditId}`;
  const [r] = await db<(WebhookLinkSnapshot & { audit_id: string })[]>`
    select r.id, r.audit_id, r.tracking_token as token, r.external_ref, r.views_count,
           (select min(v.viewed_at) from radar_audit_views v where v.radar_audit_id = r.id)
             as first_opened_at
      from radar_audits r
     where ${filter}
     order by (r.origin = 'dashboard') desc, r.created_at asc
     limit 1
  `;
  return r ?? null;
}

/**
 * Writes one event to the outbox, inside the caller's transaction. Skipped
 * (returns null) when no active endpoint subscribes to the type, so an
 * install without webhooks writes nothing. Never throws on a missing audit
 * or link: the event is simply not written.
 */
export async function emitWebhookEvent(db: Queryable, input: EmitInput): Promise<string | null> {
  if (input.type === 'ping') {
    const [ep] = await db<{ id: string }[]>`
      select id from webhook_endpoints where id = ${input.endpointId}
    `;
    if (ep === undefined) return null;
  } else {
    const [sub] = await db<{ ok: boolean }[]>`
      select exists(
        select 1 from webhook_endpoints where active and ${input.type} = any(events)
      ) as ok
    `;
    if (sub?.ok !== true) return null;
  }

  const occurredAt = 'occurredAt' in input ? input.occurredAt : new Date().toISOString();
  const snapshot: WebhookSnapshot = { occurred_at: occurredAt };
  let target: string | null = null;

  switch (input.type) {
    case 'ping':
      snapshot.endpoint_id = input.endpointId;
      target = input.endpointId;
      break;
    case 'link.opened':
    case 'link.first_opened': {
      const link = await linkSnapshot(db, { linkId: input.linkId });
      if (link === null) return null;
      const { audit_id: auditId, ...rest } = link;
      snapshot.link = rest;
      snapshot.audit = await auditSnapshot(db, auditId);
      break;
    }
    default: {
      const audit = await auditSnapshot(db, input.auditId);
      if (audit === null) return null;
      snapshot.audit = audit;
      const link = await linkSnapshot(db, { auditId: input.auditId });
      if (link !== null) {
        const { audit_id: _ignored, ...rest } = link;
        snapshot.link = rest;
      } else {
        snapshot.link = null;
      }
      if (input.type === 'email.sent' || input.type === 'email.failed') {
        snapshot.email = input.email;
      }
    }
  }

  const id = newWebhookEventId();
  await db`
    insert into webhook_events (id, type, snapshot, target_endpoint_id, created_at)
    values (${id}, ${input.type}, ${jsonb(db, snapshot)}, ${target}, ${occurredAt})
  `;
  return id;
}

/** Finished scan: audit.refreshed when it replaced a previous one, audit.completed otherwise. */
export async function emitAuditFinished(
  db: Queryable,
  auditId: string,
  status: 'completed' | 'failed',
): Promise<string | null> {
  if (status === 'failed') return emitWebhookEvent(db, { type: 'audit.failed', auditId });
  const [prev] = await db<{ id: string }[]>`
    select id from audits_full where replaced_by = ${auditId} limit 1
  `;
  return emitWebhookEvent(db, {
    type: prev === undefined ? 'audit.completed' : 'audit.refreshed',
    auditId,
  });
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

function trimError(e: string | null): string | null {
  return e === null ? null : e.slice(0, 200);
}

export function createWebhooksRepo(sql: Sql) {
  const cols = sql(ENDPOINT_COLUMNS as unknown as string[]);

  async function get(id: string): Promise<WebhookEndpointRow | null> {
    const [row] = await sql<WebhookEndpointRow[]>`
      select ${cols} from webhook_endpoints where id = ${id}
    `;
    return row ?? null;
  }

  return {
    // ---------------------------------------------------------------- endpoints

    async list(): Promise<WebhookEndpointRow[]> {
      return sql<WebhookEndpointRow[]>`
        select ${cols} from webhook_endpoints order by system_key nulls last, created_at asc
      `;
    },

    get,

    /** Creates an endpoint. `id` is chosen by the caller (it is the secret's AAD). */
    async create(input: {
      id?: string;
      url: string;
      description?: string | null;
      events: WebhookSubscribableEvent[];
      active?: boolean;
      secretCiphertext: string;
      secretHint: string;
    }): Promise<WebhookEndpointRow> {
      const [row] = await sql<WebhookEndpointRow[]>`
        insert into webhook_endpoints (id, url, description, events, active,
                                       secret_ciphertext, secret_hint)
        values (${input.id ?? randomUUID()}, ${input.url}, ${input.description ?? null},
                ${input.events}, ${input.active ?? true}, ${input.secretCiphertext},
                ${input.secretHint})
        returning ${cols}
      `;
      if (row === undefined) throw new Error('webhook_endpoints insert returned no row');
      return row;
    },

    /**
     * Partial update. Re-activating an endpoint clears its failure streak and
     * the automatic disable. URL changes are refused on the env-managed one.
     */
    async update(
      id: string,
      patch: {
        url?: string;
        description?: string | null;
        events?: WebhookSubscribableEvent[];
        active?: boolean;
        legacy_radar_format?: boolean;
      },
    ): Promise<WebhookEndpointRow | null> {
      const set: Record<string, unknown> = {};
      if (patch.url !== undefined) set.url = patch.url;
      if (patch.description !== undefined) set.description = patch.description;
      if (patch.events !== undefined) set.events = patch.events;
      if (patch.legacy_radar_format !== undefined) {
        set.legacy_radar_format = patch.legacy_radar_format;
      }
      if (patch.active !== undefined) {
        set.active = patch.active;
        if (patch.active) {
          set.consecutive_failures = 0;
          set.disabled_at = null;
          set.disabled_reason = null;
        }
      }
      if (Object.keys(set).length === 0) return get(id);
      const [row] = await sql<WebhookEndpointRow[]>`
        update webhook_endpoints set ${sql(set as Record<string, string>)}, updated_at = now()
         where id = ${id}
           and (${patch.url === undefined} or system_key is null)
        returning ${cols}
      `;
      return row ?? null;
    },

    async setSecret(
      id: string,
      secretCiphertext: string,
      secretHint: string,
    ): Promise<WebhookEndpointRow | null> {
      const [row] = await sql<WebhookEndpointRow[]>`
        update webhook_endpoints
           set secret_ciphertext = ${secretCiphertext}, secret_hint = ${secretHint},
               updated_at = now()
         where id = ${id} and system_key is null
        returning ${cols}
      `;
      return row ?? null;
    },

    /** Deletes an endpoint and its delivery log. The env-managed one cannot be deleted. */
    async delete(id: string): Promise<boolean> {
      const res = await sql`delete from webhook_endpoints where id = ${id} and system_key is null`;
      return res.count > 0;
    },

    /**
     * Keeps the Radar endpoint in sync with RADAR_WEBHOOK_URL at boot.
     * url set: created on first boot (link.opened, legacy format, active),
     * afterwards only the URL follows the environment (the toggles stay the
     * admin's). url null: switched off with disabled_reason 'env_removed'.
     */
    async syncRadarEndpoint(url: string | null): Promise<WebhookEndpointRow | null> {
      if (url === null) {
        const [row] = await sql<WebhookEndpointRow[]>`
          update webhook_endpoints
             set active = false, disabled_at = coalesce(disabled_at, now()),
                 disabled_reason = 'env_removed', updated_at = now()
           where system_key = 'radar' and active
          returning ${cols}
        `;
        return row ?? null;
      }
      const [row] = await sql<WebhookEndpointRow[]>`
        insert into webhook_endpoints (url, description, events, active, legacy_radar_format, system_key)
        values (${url}, 'Radar (RADAR_WEBHOOK_URL)', ${['link.opened']}, true, true, 'radar')
        on conflict (system_key) do update set
          url = excluded.url,
          -- Back after an env removal: on again.
          active = case when webhook_endpoints.disabled_reason = 'env_removed' then true
                        else webhook_endpoints.active end,
          disabled_at = case when webhook_endpoints.disabled_reason = 'env_removed' then null
                             else webhook_endpoints.disabled_at end,
          disabled_reason = case when webhook_endpoints.disabled_reason = 'env_removed' then null
                                 else webhook_endpoints.disabled_reason end,
          updated_at = now()
        returning ${cols}
      `;
      return row ?? null;
    },

    /** Endpoints switched off after too many failures (dashboard alert). */
    async listAutoDisabled(): Promise<WebhookEndpointRow[]> {
      return sql<WebhookEndpointRow[]>`
        select ${cols} from webhook_endpoints
         where not active and disabled_reason = 'auto'
         order by disabled_at desc
      `;
    },

    // ---------------------------------------------------------------- events

    /** Writes a test event for one endpoint (delivered even if it is off). */
    async ping(endpointId: string): Promise<string | null> {
      return emitWebhookEvent(sql, { type: 'ping', endpointId });
    },

    /**
     * Fan-out: every undispatched event becomes one delivery per subscribed
     * active endpoint (a ping: its target only), with the body rendered once
     * and fixed. Locked rows are skipped, so several dispatchers can run.
     * Returns the new delivery ids.
     */
    async fanOut(baseUrl: string, limit = 100): Promise<string[]> {
      return sql.begin(async (tx) => {
        const events = await tx<
          {
            id: string;
            type: WebhookEventType;
            snapshot: WebhookSnapshot;
            target_endpoint_id: string | null;
            created_at: string;
          }[]
        >`
          select id, type, snapshot, target_endpoint_id, created_at
            from webhook_events
           where dispatched_at is null
           order by created_at asc
           limit ${limit}
           for update skip locked
        `;
        const created: string[] = [];
        for (const ev of events) {
          const endpoints =
            ev.target_endpoint_id !== null
              ? await tx<{ id: string; legacy_radar_format: boolean }[]>`
                  select id, legacy_radar_format from webhook_endpoints
                   where id = ${ev.target_endpoint_id}
                `
              : await tx<{ id: string; legacy_radar_format: boolean }[]>`
                  select id, legacy_radar_format from webhook_endpoints
                   where active and ${ev.type} = any(events)
                `;
          let standard: string | null = null;
          for (const ep of endpoints) {
            const legacy = ep.legacy_radar_format
              ? buildLegacyRadarBody(ev.type, ev.snapshot)
              : null;
            const body =
              legacy ??
              (standard ??= JSON.stringify(
                buildWebhookPayload(
                  { id: ev.id, type: ev.type, created_at: ev.created_at, snapshot: ev.snapshot },
                  baseUrl,
                ),
              ));
            const [d] = await tx<{ id: string }[]>`
              insert into webhook_deliveries (endpoint_id, event_id, format, request_body)
              values (${ep.id}, ${ev.id}, ${legacy !== null ? 'legacy_radar' : 'standard'}, ${body})
              returning id
            `;
            if (d) created.push(d.id);
          }
          await tx`update webhook_events set dispatched_at = now() where id = ${ev.id}`;
        }
        return created;
      });
    },

    /** Pending deliveries whose attempt is due and not claimed (safety sweep). */
    async listDue(limit = 100): Promise<{ id: string; attempt: number }[]> {
      const rows = await sql<{ id: string; attempts: number }[]>`
        select id, attempts from webhook_deliveries
         where status = 'pending' and next_attempt_at <= now()
           and (locked_until is null or locked_until < now())
         order by next_attempt_at asc
         limit ${limit}
      `;
      return rows.map((r) => ({ id: r.id, attempt: r.attempts + 1 }));
    },

    /**
     * Atomic claim of attempt `attempt` of a delivery. Null when it is no
     * longer pending, already at another attempt, or claimed by another
     * worker (a duplicate job): the caller then does nothing.
     */
    async claim(id: string, attempt: number, lockMs = 120_000): Promise<ClaimedDelivery | null> {
      const [row] = await sql<(ClaimedDelivery & { targeted: boolean })[]>`
        with c as (
          update webhook_deliveries
             set locked_until = now() + make_interval(secs => ${lockMs / 1000})
           where id = ${id} and status = 'pending' and attempts = ${attempt - 1}
             and (locked_until is null or locked_until < now())
          returning id, event_id, endpoint_id, format, request_body
        )
        select c.id, ${attempt}::int as attempt, c.event_id, ev.type as event_type, c.format,
               c.request_body, c.endpoint_id, e.url as endpoint_url, e.active as endpoint_active,
               e.secret_ciphertext, e.system_key, (ev.target_endpoint_id is not null) as targeted
          from c
          join webhook_endpoints e on e.id = c.endpoint_id
          join webhook_events ev on ev.id = c.event_id
      `;
      if (row === undefined) return null;
      // A ping is delivered even to an endpoint that is off.
      const { targeted, ...rest } = row;
      return { ...rest, endpoint_active: rest.endpoint_active || targeted };
    },

    /**
     * Records one attempt and moves the delivery on: success, retry later
     * (backoff schedule) or final failure. A final failure bumps the
     * endpoint's streak and switches it off at WEBHOOK_AUTO_DISABLE_AFTER;
     * a success resets the streak.
     */
    async recordAttempt(
      delivery: { id: string; attempt: number; endpointId: string },
      result: AttemptResult,
    ): Promise<AttemptOutcome> {
      return sql.begin(async (tx) => {
        await tx`
          insert into webhook_delivery_attempts
            (delivery_id, attempt, status_code, error, duration_ms, response_body)
          values (${delivery.id}, ${delivery.attempt}, ${result.statusCode},
                  ${trimError(result.error)}, ${Math.max(0, Math.round(result.durationMs))},
                  ${result.responseBody === null ? null : result.responseBody.slice(0, 2048)})
          on conflict (delivery_id, attempt) do nothing
        `;
        const last = {
          last_status_code: result.statusCode,
          last_error: trimError(result.error),
          last_duration_ms: Math.max(0, Math.round(result.durationMs)),
        };
        await tx`
          update webhook_endpoints
             set last_status = ${result.ok ? 'success' : 'failed'},
                 last_status_code = ${result.statusCode}, last_delivery_at = now()
           where id = ${delivery.endpointId}
        `;
        if (result.ok) {
          await tx`
            update webhook_deliveries
               set status = 'success', attempts = ${delivery.attempt}, locked_until = null,
                   completed_at = now(), ${tx(last)}
             where id = ${delivery.id}
          `;
          await tx`
            update webhook_endpoints set consecutive_failures = 0 where id = ${delivery.endpointId}
          `;
          return { kind: 'success' as const };
        }
        const delay = result.retryable ? webhookBackoffMs(delivery.attempt) : null;
        if (delay !== null) {
          await tx`
            update webhook_deliveries
               set attempts = ${delivery.attempt}, locked_until = null,
                   next_attempt_at = now() + make_interval(secs => ${delay / 1000}), ${tx(last)}
             where id = ${delivery.id}
          `;
          return { kind: 'retry' as const, nextAttempt: delivery.attempt + 1, delayMs: delay };
        }
        await tx`
          update webhook_deliveries
             set status = 'failed', attempts = ${delivery.attempt}, locked_until = null,
                 completed_at = now(), ${tx(last)}
           where id = ${delivery.id}
        `;
        const [ep] = await tx<{ disabled: boolean }[]>`
          update webhook_endpoints
             set consecutive_failures = consecutive_failures + 1,
                 active = case when active and consecutive_failures + 1 >= ${WEBHOOK_AUTO_DISABLE_AFTER}
                               then false else active end,
                 disabled_at = case when active and consecutive_failures + 1 >= ${WEBHOOK_AUTO_DISABLE_AFTER}
                                    then now() else disabled_at end,
                 disabled_reason = case when active and consecutive_failures + 1 >= ${WEBHOOK_AUTO_DISABLE_AFTER}
                                        then 'auto' else disabled_reason end
           where id = ${delivery.endpointId}
          returning (not active and disabled_reason = 'auto'
                     and consecutive_failures = ${WEBHOOK_AUTO_DISABLE_AFTER}) as disabled
        `;
        return { kind: 'failed' as const, endpointDisabled: ep?.disabled === true };
      });
    },

    /** Closes a delivery without sending (endpoint switched off or secret missing). */
    async cancel(id: string, attempt: number, error: string): Promise<void> {
      await sql`
        update webhook_deliveries
           set status = 'failed', locked_until = null, completed_at = now(),
               last_error = ${error.slice(0, 200)}, attempts = greatest(attempts, ${attempt - 1})
         where id = ${id} and status = 'pending'
      `;
    },

    /** "Renvoyer": a new delivery of the same event, same body, same event id. */
    async resend(deliveryId: string): Promise<string | null> {
      const [row] = await sql<{ id: string }[]>`
        insert into webhook_deliveries (endpoint_id, event_id, format, request_body, manual)
        select endpoint_id, event_id, format, request_body, true
          from webhook_deliveries where id = ${deliveryId}
        returning id
      `;
      return row?.id ?? null;
    },

    // ---------------------------------------------------------------- log

    async listDeliveries(
      endpointId: string,
      q: { limit: number; offset: number; status?: 'pending' | 'success' | 'failed' },
    ): Promise<{ rows: WebhookDeliveryRow[]; total: number }> {
      const status = q.status ?? null;
      const rows = await sql<WebhookDeliveryRow[]>`
        select d.id, d.endpoint_id, d.event_id, ev.type as event_type, d.format, d.status,
               d.attempts, d.next_attempt_at, d.last_status_code, d.last_duration_ms,
               d.last_error, d.manual, d.created_at, d.completed_at
          from webhook_deliveries d
          join webhook_events ev on ev.id = d.event_id
         where d.endpoint_id = ${endpointId}
           and (${status}::text is null or d.status = ${status})
         order by d.created_at desc, d.id
         limit ${Math.min(Math.max(q.limit, 1), 100)} offset ${Math.max(q.offset, 0)}
      `;
      const [count] = await sql<{ n: number }[]>`
        select count(*)::int as n from webhook_deliveries
         where endpoint_id = ${endpointId} and (${status}::text is null or status = ${status})
      `;
      return { rows: [...rows], total: count?.n ?? 0 };
    },

    async getDelivery(id: string): Promise<WebhookDeliveryDetail | null> {
      const [d] = await sql<(WebhookDeliveryRow & { request_body: string })[]>`
        select d.id, d.endpoint_id, d.event_id, ev.type as event_type, d.format, d.status,
               d.attempts, d.next_attempt_at, d.last_status_code, d.last_duration_ms,
               d.last_error, d.manual, d.created_at, d.completed_at, d.request_body
          from webhook_deliveries d
          join webhook_events ev on ev.id = d.event_id
         where d.id = ${id}
      `;
      if (d === undefined) return null;
      const attempts = await sql<WebhookAttemptRow[]>`
        select attempt, status_code, error, duration_ms, response_body, created_at
          from webhook_delivery_attempts where delivery_id = ${id}
         order by attempt asc
      `;
      return { ...d, attempts_log: [...attempts] };
    },

    /** Daily purge: events and deliveries older than WEBHOOK_LOG_DAYS. */
    async purgeOld(days = WEBHOOK_LOG_DAYS): Promise<{ events: number; deliveries: number }> {
      const deliveries = await sql`
        delete from webhook_deliveries
         where created_at < now() - make_interval(days => ${days}) and status <> 'pending'
      `;
      const events = await sql`
        delete from webhook_events ev
         where ev.created_at < now() - make_interval(days => ${days})
           and not exists (select 1 from webhook_deliveries d
                            where d.event_id = ev.id and d.status = 'pending')
      `;
      return { events: events.count, deliveries: deliveries.count };
    },
  };
}

export type WebhooksRepo = ReturnType<typeof createWebhooksRepo>;
