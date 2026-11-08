-- Phase 4c: interface v2 and report redesign.
--   - per-audit report template, favicon and live progress step;
--   - report settings (default template, fonts, custom font), custom
--     templates and per-template state (enabled, settings);
--   - agency SMTP settings (password encrypted by the app with
--     APP_ENCRYPTION_KEY, like the AI keys) and the per-audit send log.
--
-- 0001 to 0007 are never edited. Additive only.
--
-- "Préparation IA" (module ai_readiness) is now ON by default for new
-- installs: the default lives in code (DEFAULT_AUDIT_MODULES) and applies
-- while audit_settings has no row. Installs that already saved their module
-- defaults keep their choice; audits stored without the key keep reading it
-- as false (the module did not run for them). "Inclure dans le score
-- global" stays off by default.

-- =====================================================
-- audits_full : template, favicon, progress
-- =====================================================

-- Report template of the audit. NULL = the install default at render time.
alter table audits_full add column template_id text;
alter table audits_full add constraint audits_full_template_id_check
  check (template_id is null or template_id ~ '^[a-z][a-z0-9-]{1,39}$');

-- Media key of the site favicon fetched by the scanner (favicon/<id>.<ext>).
alter table audits_full add column favicon_key text;
alter table audits_full add constraint audits_full_favicon_key_check
  check (
    favicon_key is null
    or favicon_key ~ '^favicon/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|ico|jpg|gif|webp)$'
  );

-- Step of a running audit, for the live progress in the dashboard.
alter table audits_full add column progress_step text;
alter table audits_full add constraint audits_full_progress_step_check
  check (progress_step is null or progress_step in ('loading', 'analysis', 'writing'));

-- =====================================================
-- report_settings : default template and fonts (single row)
-- =====================================================

create table report_settings (
  id boolean primary key default true
    constraint report_settings_singleton check (id),
  default_template_id text not null default 'standard'
    constraint report_settings_default_template_check
    check (default_template_id ~ '^[a-z][a-z0-9-]{1,39}$'),
  heading_font text not null default 'inter'
    constraint report_settings_heading_font_check check (heading_font ~ '^[a-z0-9-]{1,40}$'),
  body_font text not null default 'inter'
    constraint report_settings_body_font_check check (body_font ~ '^[a-z0-9-]{1,40}$'),
  -- Custom family uploaded by the agency (woff2 files in the media store).
  custom_font_name text
    constraint report_settings_custom_font_name_check
    check (custom_font_name is null or char_length(custom_font_name) between 1 and 40),
  custom_font_regular_key text
    constraint report_settings_custom_font_regular_check
    check (custom_font_regular_key is null or custom_font_regular_key ~ '^fonts/[a-z0-9]{8,32}\.woff2$'),
  custom_font_bold_key text
    constraint report_settings_custom_font_bold_check
    check (custom_font_bold_key is null or custom_font_bold_key ~ '^fonts/[a-z0-9]{8,32}\.woff2$'),
  updated_at timestamptz not null default now()
);

-- =====================================================
-- report_templates : templates created by the agency
-- =====================================================
-- Built-in templates (standard, compact, commercial) ship with the code and
-- never live here. Files are text (Liquid, CSS, manifest); the preview is a
-- base64 PNG. Validated by the app before every write.

create table report_templates (
  id text primary key
    constraint report_templates_id_check check (id ~ '^[a-z][a-z0-9-]{1,39}$'),
  manifest jsonb not null
    constraint report_templates_manifest_shape check (jsonb_typeof(manifest) = 'object'),
  files jsonb not null
    constraint report_templates_files_shape check (
      jsonb_typeof(files) = 'object' and octet_length(files::text) <= 3000000
    ),
  preview text
    constraint report_templates_preview_len check (preview is null or char_length(preview) <= 1400000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Enabled flag and settings values of every template (built-in or not).
-- No row = enabled, default settings.
create table report_template_state (
  template_id text primary key
    constraint report_template_state_id_check check (template_id ~ '^[a-z][a-z0-9-]{1,39}$'),
  enabled boolean not null default true,
  settings jsonb not null default '{}'::jsonb
    constraint report_template_state_settings_shape check (
      jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 65536
    ),
  updated_at timestamptz not null default now()
);

-- =====================================================
-- smtp_settings : agency SMTP (single row)
-- =====================================================

create table smtp_settings (
  id boolean primary key default true
    constraint smtp_settings_singleton check (id),
  host text not null
    constraint smtp_settings_host_check check (host ~ '^[A-Za-z0-9.-]{1,253}$'),
  port integer not null
    constraint smtp_settings_port_check check (port between 1 and 65535),
  security text not null default 'starttls'
    constraint smtp_settings_security_check check (security in ('tls', 'starttls', 'none')),
  username text
    constraint smtp_settings_username_len check (username is null or char_length(username) <= 254),
  -- "v1.<iv>.<tag>.<ciphertext>" (AES-256-GCM, APP_ENCRYPTION_KEY). Never sent to a browser.
  password_ciphertext text
    constraint smtp_settings_password_len
    check (password_ciphertext is null or char_length(password_ciphertext) between 20 and 2000),
  password_hint text
    constraint smtp_settings_password_hint_len
    check (password_hint is null or char_length(password_hint) <= 16),
  from_name text not null
    constraint smtp_settings_from_name_len check (char_length(from_name) between 1 and 80),
  from_email text not null
    constraint smtp_settings_from_email_check
    check (char_length(from_email) <= 254 and from_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  reply_to text
    constraint smtp_settings_reply_to_check
    check (reply_to is null or (char_length(reply_to) <= 254 and reply_to ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')),
  subject_template text not null
    constraint smtp_settings_subject_len check (char_length(subject_template) between 1 and 200),
  body_template text not null
    constraint smtp_settings_body_len check (char_length(body_template) between 1 and 5000),
  updated_at timestamptz not null default now()
);

comment on column smtp_settings.password_ciphertext is 'AES-256-GCM ciphertext. Never logged, never sent to a browser.';

-- =====================================================
-- email_sends : "Envoyer le rapport" log
-- =====================================================

create table email_sends (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null references audits_full(id) on delete cascade,
  -- PII: never exposed by public reads nor by the public API.
  recipient text not null
    constraint email_sends_recipient_len check (char_length(recipient) between 3 and 254),
  subject text not null
    constraint email_sends_subject_len check (char_length(subject) between 1 and 200),
  status text not null
    constraint email_sends_status_check check (status in ('sent', 'failed')),
  -- Short machine code on failure (auth, connection, rejected...). Never the SMTP transcript.
  error_code text
    constraint email_sends_error_code_len check (error_code is null or char_length(error_code) <= 64),
  created_at timestamptz not null default now()
);

create index email_sends_audit_created_idx on email_sends(audit_id, created_at desc);
create index email_sends_created_idx on email_sends(created_at desc);

comment on column email_sends.recipient is 'PII. Dashboard only.';
