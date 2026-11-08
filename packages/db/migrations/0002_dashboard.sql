-- Phase 4: agency dashboard, generalized tracking links, simplified view
-- tracking (CNIL art. 82) and agency branding.
--
-- 0001 is never edited: every change below is additive or relaxes a
-- constraint, so a database already running 0001 upgrades in place.


-- =====================================================
-- audits_full : dashboard source, label, refresh chain
-- =====================================================

alter table audits_full drop constraint audits_full_source_check;
alter table audits_full add constraint audits_full_source_check
  check (source in ('web', 'radar', 'dashboard'));

-- Free label / reference typed by the agency when it launches an audit.
alter table audits_full add column label text;
alter table audits_full add constraint audits_full_label_len
  check (label is null or char_length(label) between 1 and 120);

-- Set on the old scan when a refresh replaces it (the public link moves to
-- the new scan). The dashboard only lists audits where this is NULL.
alter table audits_full add column replaced_by uuid
  references audits_full(id) on delete set null;

create index audits_full_current_created_at_idx
  on audits_full(created_at desc) where replaced_by is null;
create index audits_full_replaced_by_idx
  on audits_full(replaced_by) where replaced_by is not null;

-- =====================================================
-- radar_audits : now the generic tracking link table
-- =====================================================
-- The name is kept so the Radar API code and its contract stay untouched.
-- A row is either a Radar link (external_ref set, origin 'radar') or a
-- link created from the dashboard (no external_ref, origin 'dashboard').

alter table radar_audits alter column external_ref drop not null;
alter table radar_audits add column origin text not null default 'radar';
alter table radar_audits add constraint radar_audits_origin_check
  check (origin in ('radar', 'dashboard'));
alter table radar_audits add constraint radar_audits_external_ref_by_origin
  check (origin = 'dashboard' or external_ref is not null);

-- =====================================================
-- radar_audit_views : minimal view record
-- =====================================================
-- The beacon now only says "this link was opened". duration_s and
-- sections_viewed are no longer written (always 0 / []); they stay for
-- backward compatibility of existing rows and of the Radar webhook payload.
-- user_agent now holds a coarse family ("Chrome, ordinateur"), capped at 200.

update radar_audit_views set user_agent = left(user_agent, 200)
 where user_agent is not null and char_length(user_agent) > 200;
alter table radar_audit_views drop constraint radar_audit_views_user_agent_len;
alter table radar_audit_views add constraint radar_audit_views_user_agent_len
  check (user_agent is null or char_length(user_agent) <= 200);

comment on column radar_audit_views.duration_s is 'Deprecated: always 0 since 0002 (no reading-time tracking).';
comment on column radar_audit_views.sections_viewed is 'Deprecated: always [] since 0002 (no section tracking).';
comment on column radar_audit_views.session_hash is 'Deprecated: NULL since 0002 (no browser storage).';

-- =====================================================
-- agency_settings : single-row branding of the install
-- =====================================================

create table agency_settings (
  id boolean primary key default true
    constraint agency_settings_singleton check (id),
  name text not null
    constraint agency_settings_name_len check (char_length(name) between 1 and 80),
  website_url text
    constraint agency_settings_website_url_check
    check (website_url is null or (char_length(website_url) <= 300 and website_url ~ '^https?://')),
  -- Optional call to action shown at the end of the reports.
  contact_url text
    constraint agency_settings_contact_url_check
    check (contact_url is null or (char_length(contact_url) <= 300 and contact_url ~ '^(https?://|mailto:)')),
  -- Media key of the logo (brand/logo-<random>.png|jpg), served at /media/brand/logo.
  logo_key text
    constraint agency_settings_logo_key_check
    check (logo_key is null or logo_key ~ '^brand/logo-[a-z0-9]{8,32}\.(png|jpg)$'),
  primary_color text
    constraint agency_settings_primary_color_check
    check (primary_color is null or primary_color ~ '^#[0-9a-fA-F]{6}$'),
  report_footer text
    constraint agency_settings_report_footer_len
    check (report_footer is null or char_length(report_footer) <= 500),
  -- Daily rate used by the time-to-fix estimate (overrides AUDIT_DAILY_RATE_EUR).
  daily_rate_eur integer
    constraint agency_settings_daily_rate_range
    check (daily_rate_eur is null or daily_rate_eur between 0 and 10000),
  updated_at timestamptz not null default now()
);
