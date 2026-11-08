-- Phase 4d: outgoing signed webhooks (docs/webhooks.md).
--
--   webhook_endpoints          one row per target URL (the agency's n8n, Make, CRM...)
--   webhook_events             outbox: one row per event, written in the same
--                              transaction as the state change that caused it
--   webhook_deliveries         one row per (event, endpoint), the exact body sent
--   webhook_delivery_attempts  one row per HTTP attempt (status, duration, response)
--
-- The scanner dispatcher fans undelivered events out to the subscribed
-- endpoints and sends them through BullMQ. Deliveries and events are purged
-- after 30 days by the daily purge job.
--
-- 0001 to 0008 are never edited. Additive only.

-- =====================================================
-- webhook_endpoints
-- =====================================================

create table webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  url text not null
    constraint webhook_endpoints_url_check
    check (char_length(url) between 10 and 2048 and url ~ '^https?://'),
  description text
    constraint webhook_endpoints_description_len
    check (description is null or char_length(description) between 1 and 120),
  -- Subscribed event types. "ping" is never subscribed: it is sent on demand.
  events text[] not null default '{}'
    constraint webhook_endpoints_events_check
    check (events <@ array[
      'audit.created', 'audit.completed', 'audit.failed', 'audit.refreshed', 'audit.deleted',
      'link.first_opened', 'link.opened', 'email.sent', 'email.failed'
    ]::text[]),
  active boolean not null default true,
  -- Signing secret, AES-256-GCM with APP_ENCRYPTION_KEY (AAD "webhook:<id>").
  -- Encrypted, not hashed: the dispatcher needs it to sign. NULL only for the
  -- endpoint managed by the environment (Radar), signed with RADAR_WEBHOOK_SECRET.
  secret_ciphertext text
    constraint webhook_endpoints_secret_len
    check (secret_ciphertext is null or char_length(secret_ciphertext) between 20 and 2000),
  secret_hint text
    constraint webhook_endpoints_secret_hint_len
    check (secret_hint is null or char_length(secret_hint) <= 16),
  -- Historical Radar contract for link openings: "audit_viewed" body,
  -- X-Mynto-Timestamp + X-Mynto-Signature "sha256=" headers.
  legacy_radar_format boolean not null default false,
  -- Set on endpoints created and kept in sync from the environment.
  system_key text unique
    constraint webhook_endpoints_system_key_check
    check (system_key is null or system_key in ('radar')),
  consecutive_failures integer not null default 0
    constraint webhook_endpoints_failures_check check (consecutive_failures >= 0),
  disabled_at timestamptz,
  disabled_reason text
    constraint webhook_endpoints_disabled_reason_check
    check (disabled_reason is null or disabled_reason in ('auto', 'env_removed')),
  last_status text
    constraint webhook_endpoints_last_status_check
    check (last_status is null or last_status in ('success', 'failed')),
  last_status_code integer,
  last_delivery_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhook_endpoints_secret_source
    check (system_key is not null or secret_ciphertext is not null)
);

create index webhook_endpoints_events_idx on webhook_endpoints using gin (events) where active;

comment on column webhook_endpoints.secret_ciphertext is 'AES-256-GCM ciphertext. Never logged, never sent to a browser.';

-- =====================================================
-- webhook_events : outbox
-- =====================================================

create table webhook_events (
  -- "evt_" + 24 hex characters. Stable across attempts and re-sends:
  -- receivers dedupe on it.
  id text primary key
    constraint webhook_events_id_format check (id ~ '^evt_[0-9a-f]{24}$'),
  type text not null
    constraint webhook_events_type_check
    check (type in (
      'audit.created', 'audit.completed', 'audit.failed', 'audit.refreshed', 'audit.deleted',
      'link.first_opened', 'link.opened', 'email.sent', 'email.failed', 'ping'
    )),
  -- Data captured at the time of the event (audit, link, email). Never the
  -- visitor IP, user agent or the audit contact email.
  snapshot jsonb not null
    constraint webhook_events_snapshot_shape
    check (jsonb_typeof(snapshot) = 'object' and octet_length(snapshot::text) <= 64000),
  -- "ping": only this endpoint receives the event.
  target_endpoint_id uuid references webhook_endpoints(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Set once the event has been fanned out to its endpoints.
  dispatched_at timestamptz
);

create index webhook_events_pending_idx on webhook_events(created_at) where dispatched_at is null;
create index webhook_events_created_idx on webhook_events(created_at);

-- =====================================================
-- webhook_deliveries
-- =====================================================

create table webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references webhook_endpoints(id) on delete cascade,
  event_id text not null references webhook_events(id) on delete cascade,
  format text not null default 'standard'
    constraint webhook_deliveries_format_check check (format in ('standard', 'legacy_radar')),
  -- Exact bytes sent (the signature covers them). Fixed at fan-out time.
  request_body text not null
    constraint webhook_deliveries_body_len check (octet_length(request_body) <= 131072),
  status text not null default 'pending'
    constraint webhook_deliveries_status_check check (status in ('pending', 'success', 'failed')),
  attempts integer not null default 0
    constraint webhook_deliveries_attempts_check check (attempts between 0 and 20),
  next_attempt_at timestamptz not null default now(),
  -- Claim of the attempt in progress (crash recovery: expires on its own).
  locked_until timestamptz,
  last_status_code integer,
  last_error text
    constraint webhook_deliveries_last_error_len check (last_error is null or char_length(last_error) <= 200),
  last_duration_ms integer,
  -- Created by "Renvoyer".
  manual boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index webhook_deliveries_due_idx on webhook_deliveries(next_attempt_at) where status = 'pending';
create index webhook_deliveries_endpoint_idx on webhook_deliveries(endpoint_id, created_at desc);
create index webhook_deliveries_event_idx on webhook_deliveries(event_id);
create index webhook_deliveries_created_idx on webhook_deliveries(created_at);

-- =====================================================
-- webhook_delivery_attempts
-- =====================================================

create table webhook_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references webhook_deliveries(id) on delete cascade,
  attempt integer not null constraint webhook_delivery_attempts_attempt_check check (attempt >= 1),
  status_code integer,
  -- Short machine code (timeout, network_error, redirect_refused, blocked_target...).
  error text
    constraint webhook_delivery_attempts_error_len check (error is null or char_length(error) <= 200),
  duration_ms integer not null default 0,
  -- First 2 KB of the receiver's answer.
  response_body text
    constraint webhook_delivery_attempts_response_len check (response_body is null or char_length(response_body) <= 2048),
  created_at timestamptz not null default now(),
  unique (delivery_id, attempt)
);
