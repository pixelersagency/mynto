-- Phase 4b+: "Préparation IA" (agent readiness), optional 9th module.
--
-- 0001 to 0006 are never edited. Additive only: existing rows keep NULL in
-- both columns ("Non évalué").

-- Full result of the 24 deterministic tests:
--   { "version": 1, "status": "completed" | "failed", "scanned_at": "...",
--     "score": 0-100 | null, "level": 0-5 | null, "level_name": "...",
--     "max_level": 0-5, "site_type": "vitrine" | ..., "site_type_auto": bool,
--     "site_type_signals": [...], "included_in_global_score": bool,
--     "error": null | "site_unreachable", "checks": [ { id, category, status,
--     message, evidence, specUrls, fixPrompt?, weight, applicable? }, ... ] }
-- Public data only (what the audited site serves to anyone): it is part of
-- the public report columns. NULL = module off or audit older than 0007.
alter table audits_full add column ai_readiness jsonb;
alter table audits_full add constraint audits_full_ai_readiness_shape
  check (
    ai_readiness is null or (
      jsonb_typeof(ai_readiness) = 'object'
      and jsonb_typeof(ai_readiness -> 'checks') = 'array'
      and octet_length(ai_readiness::text) <= 300000
    )
  );

-- Score 0-100 copied out of ai_readiness for sorting, filtering and the
-- analytics aggregates. NULL when the module was off or the run failed.
alter table audits_full add column ai_score smallint;
alter table audits_full add constraint audits_full_ai_score_range
  check (ai_score is null or ai_score between 0 and 100);

create index audits_full_ai_score_idx on audits_full(ai_score) where ai_score is not null;

comment on column audits_full.ai_readiness is 'Préparation IA results (module ai_readiness). NULL = not evaluated.';
comment on column audits_full.ai_score is 'Préparation IA score 0-100. Not part of global_score unless modules.ai_in_global_score.';
