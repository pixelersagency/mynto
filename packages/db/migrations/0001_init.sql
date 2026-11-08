-- Mynto self-hosted schema, consolidated from the original Mynto (Supabase)
-- migrations, final state, kept tables only.
--
-- Single tenant, server-side access only: no RLS, no role grants. Public
-- read paths are restricted in application code (packages/db, fixed column
-- lists that never include email, llm_input or source).
--
-- Dropped on purpose compared to the hosted product: tier, unlocked_axes,
-- site_id, user_id (and their FKs to sites / auth.users), the
-- "email required unless radar" CHECK (email is optional now), the
-- Supabase Storage bucket (hero screenshots live in MEDIA_DIR) and the
-- pg_cron purge (now a BullMQ repeatable job in the scanner worker).
-- Requires PostgreSQL 13+ (built-in gen_random_uuid()).


-- =====================================================
-- audits_full : one row per 8-axis audit
-- =====================================================

create table audits_full (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  url text not null,
  -- Optional contact attached to the audit. Never exposed on public reads.
  email text,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),

  -- web (form / API) or radar (B2B prospecting via /api/radar).
  source text not null default 'web'
    constraint audits_full_source_check check (source in ('web', 'radar')),

  scanned_at timestamptz,

  stack text,
  stack_confidence numeric(4,3),

  sector text,
  sector_confidence numeric(4,3),
  main_kpi text,
  secondary_kpi text,

  -- Global score 0-10 and band.
  global_score numeric(4,2),
  global_band text
    check (global_band is null or global_band in ('excellent', 'good', 'fair', 'poor', 'critical')),

  -- Per-axis scores: { axis: { score, band, weight } }.
  axis_scores jsonb not null default '{}'::jsonb,

  exec_summary text,
  top3_priorities jsonb not null default '[]'::jsonb,
  quick_wins jsonb not null default '[]'::jsonb,
  killer_findings jsonb not null default '[]'::jsonb,
  estimated_impact_narrative text,

  -- Raw deterministic facts (public-by-nature site data, rendered by the report).
  facts jsonb not null default '{}'::jsonb,

  -- Time-to-fix chiffrage and correction-vs-redesign verdict.
  cost_estimate jsonb,
  remediation jsonb,

  -- Relative key of the hero screenshot in the media store
  -- (e.g. hero/<id>.png). NULL when the capture failed.
  hero_screenshot_key text,

  -- LLM telemetry.
  llm_provider text,
  llm_model text,
  llm_tokens_in int,
  llm_tokens_out int,
  llm_duration_ms int,
  llm_error text,

  -- Deferred narrative (Radar audits). llm_input = what the narrative call
  -- needs and that only exists in memory during the scan. Never public.
  llm_input jsonb,
  llm_status text
    constraint audits_full_llm_status_check
    check (llm_status is null or llm_status in ('deferred', 'pending', 'done', 'failed')),
  interpreted_at timestamptz,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 days'),

  constraint audits_full_llm_input_size
    check (llm_input is null or octet_length(llm_input::text) <= 500000)
);

create index audits_full_email_idx on audits_full(email);
create index audits_full_expires_at_idx on audits_full(expires_at);
create index audits_full_sector_idx on audits_full(sector);
create index audits_full_source_radar_idx on audits_full(created_at desc) where source = 'radar';

comment on column audits_full.email is 'PII. Never selected by public read paths.';
comment on column audits_full.llm_input is 'Deferred LLM inputs (Radar). Never selected by public read paths.';

-- =====================================================
-- audit_findings_full : one row per finding
-- =====================================================

create table audit_findings_full (
  id text primary key, -- rule_code:hash
  audit_id uuid not null references audits_full(id) on delete cascade,
  rule_code text not null,
  axis text not null,
  severity text not null check (severity in ('P0', 'P1', 'P2', 'P3')),
  effort text check (effort is null or effort in ('quick_win', 'standard', 'important')),
  title text not null,
  evidence jsonb not null default '{}'::jsonb,
  affected_urls jsonb not null default '[]'::jsonb,
  legal_refs jsonb not null default '[]'::jsonb,

  narrative_constat text,
  narrative_impact_business text,
  narrative_recommandation text,
  narrative_code_snippet text,

  created_at timestamptz not null default now()
);

create index audit_findings_full_audit_idx on audit_findings_full(audit_id);
create index audit_findings_full_severity_idx on audit_findings_full(severity);
create index audit_findings_full_axis_idx on audit_findings_full(axis);

-- =====================================================
-- audit_views : SSR views of public reports
-- =====================================================

create table audit_views (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits_full(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  user_agent text,
  country text,
  -- HMAC-SHA256 of the client IP with AUDIT_VIEWS_IP_HASH_SECRET. Raw IP never stored.
  ip_hash text
);

create index audit_views_audit_id_viewed_at_idx on audit_views(audit_id, viewed_at desc);
create index audit_views_audit_id_ip_hash_viewed_at_idx
  on audit_views(audit_id, ip_hash, viewed_at desc)
  where ip_hash is not null;

-- =====================================================
-- radar_audits : one row per Radar request (external_ref)
-- =====================================================

create table radar_audits (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits_full(id) on delete cascade,
  external_ref text not null unique,
  domain text not null,
  -- Bearer secret of the /r/<token> link. Never log it.
  tracking_token text not null unique,
  reused boolean not null default false,
  created_at timestamptz not null default now(),
  last_viewed_at timestamptz,
  views_count integer not null default 0,

  constraint radar_audits_external_ref_len check (char_length(external_ref) between 1 and 128),
  constraint radar_audits_domain_len check (char_length(domain) between 1 and 253),
  constraint radar_audits_tracking_token_len check (char_length(tracking_token) between 22 and 64),
  constraint radar_audits_views_count_positive check (views_count >= 0)
);

create index radar_audits_domain_created_at_idx on radar_audits(domain, created_at desc);
create index radar_audits_audit_id_idx on radar_audits(audit_id);

-- =====================================================
-- radar_audit_views : counted views of /r/<token>
-- =====================================================

create table radar_audit_views (
  id uuid primary key default gen_random_uuid(),
  radar_audit_id uuid not null references radar_audits(id) on delete cascade,
  session_hash text,
  ip_hash text,
  user_agent text,
  duration_s integer not null default 0,
  sections_viewed jsonb not null default '[]'::jsonb,
  viewed_at timestamptz not null default now(),

  constraint radar_audit_views_user_agent_len check (user_agent is null or char_length(user_agent) <= 500),
  constraint radar_audit_views_duration_range check (duration_s between 0 and 86400),
  constraint radar_audit_views_sections_is_array check (jsonb_typeof(sections_viewed) = 'array')
);

create index radar_audit_views_audit_viewed_at_idx
  on radar_audit_views(radar_audit_id, viewed_at desc);
create index radar_audit_views_session_idx
  on radar_audit_views(radar_audit_id, session_hash, viewed_at desc)
  where session_hash is not null;
create index radar_audit_views_ip_idx
  on radar_audit_views(radar_audit_id, ip_hash, viewed_at desc)
  where ip_hash is not null;
