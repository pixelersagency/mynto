-- Phase 4b: audit modules (which axes run, which costly collectors are used).
--
-- 0001 and 0002 are never edited.

-- Resolved modules of each audit:
--   { "axes": ["seo_technique", ...], "lighthouse": bool, "vision": bool,
--     "hero": bool, "narrative": bool }
-- NULL = every module enabled (audits created before this migration).
alter table audits_full add column modules jsonb;
alter table audits_full add constraint audits_full_modules_shape
  check (
    modules is null or (
      jsonb_typeof(modules) = 'object'
      and jsonb_typeof(modules -> 'axes') = 'array'
      and jsonb_array_length(modules -> 'axes') between 1 and 8
    )
  );
comment on column audits_full.modules is 'Modules the audit ran with. NULL = all enabled (pre-0003).';

-- Install-level defaults (single row). No row = every module enabled.
create table audit_settings (
  id boolean primary key default true
    constraint audit_settings_singleton check (id),
  modules jsonb not null
    constraint audit_settings_modules_shape check (
      jsonb_typeof(modules) = 'object'
      and jsonb_typeof(modules -> 'axes') = 'array'
      and jsonb_array_length(modules -> 'axes') between 1 and 8
    ),
  updated_at timestamptz not null default now()
);
