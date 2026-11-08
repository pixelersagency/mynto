-- Phase 4b: public REST API v1 and MCP server.

-- API keys of the install. Only a SHA-256 of the (high-entropy) secret is
-- stored, plus a short prefix to recognise the key in the list.
create table api_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null
    constraint api_keys_name_len check (char_length(name) between 1 and 80),
  -- "myn_live_" + first 8 characters of the random part.
  prefix text not null
    constraint api_keys_prefix_format check (prefix ~ '^myn_live_[A-Za-z0-9_-]{8}$'),
  key_hash text not null unique
    constraint api_keys_hash_format check (key_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index api_keys_active_created_idx on api_keys(created_at desc) where revoked_at is null;

-- Audits created through the API or the MCP server.
alter table audits_full drop constraint audits_full_source_check;
alter table audits_full add constraint audits_full_source_check
  check (source in ('web', 'radar', 'dashboard', 'api', 'mcp'));

create index audits_full_created_at_idx on audits_full(created_at desc);
