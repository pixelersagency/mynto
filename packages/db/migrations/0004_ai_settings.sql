-- Phase 4b: AI provider choice and API keys managed from the dashboard.
--
-- Keys are encrypted by the application (AES-256-GCM, key derived from
-- APP_ENCRYPTION_KEY) before they reach the database: this schema only ever
-- sees ciphertext and a short display hint. Env keys (ANTHROPIC_API_KEY...)
-- stay a fallback when no key is stored here.

create table ai_settings (
  id boolean primary key default true
    constraint ai_settings_singleton check (id),
  narrative_provider text not null default 'anthropic'
    constraint ai_settings_narrative_provider_check
    check (narrative_provider in ('anthropic', 'gemini', 'mistral')),
  vision_provider text not null default 'anthropic'
    constraint ai_settings_vision_provider_check
    check (vision_provider in ('anthropic', 'gemini')),
  -- { "anthropic": { "narrative": "...", "vision": "..." }, "gemini": {...}, "mistral": {...} }
  -- Missing entries use the built-in defaults.
  models jsonb not null default '{}'::jsonb
    constraint ai_settings_models_shape check (jsonb_typeof(models) = 'object'),
  updated_at timestamptz not null default now()
);

create table ai_provider_keys (
  provider text primary key
    constraint ai_provider_keys_provider_check
    check (provider in ('anthropic', 'gemini', 'mistral')),
  -- "v1.<iv>.<tag>.<ciphertext>" (base64url), see packages/db/src/secrets.ts.
  ciphertext text not null
    constraint ai_provider_keys_ciphertext_len check (char_length(ciphertext) between 20 and 2000),
  -- Masked form for display ("sk-…abcd"). Never the key itself.
  key_hint text not null
    constraint ai_provider_keys_hint_len check (char_length(key_hint) between 1 and 16),
  updated_at timestamptz not null default now()
);

comment on column ai_provider_keys.ciphertext is 'AES-256-GCM ciphertext. Never logged, never sent to a browser.';
