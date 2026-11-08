-- Phase 4b: /audit/full SSR views follow the same CNIL-simplified policy as
-- the tracking links (0002): no country, a coarse browser family instead of
-- the raw User-Agent, HMAC of the IP for the 30-minute dedupe only.

update audit_views set user_agent = case
  when user_agent is null or btrim(user_agent) = '' then null
  else
    (case
      when user_agent like '%Edg/%' then 'Edge'
      when user_agent ~ 'OPR/|Opera' then 'Opera'
      when user_agent like '%Firefox/%' then 'Firefox'
      when user_agent like '%SamsungBrowser/%' then 'Samsung Internet'
      when user_agent ~ 'Chrome/|CriOS/' then 'Chrome'
      when user_agent like '%Safari/%' then 'Safari'
      else 'Autre navigateur'
    end)
    || ', ' ||
    (case
      when user_agent ~ 'iPad|Tablet' then 'tablette'
      when user_agent ~ 'Mobi|iPhone|Android' then 'mobile'
      else 'ordinateur'
    end)
end;

alter table audit_views drop column country;
alter table audit_views add constraint audit_views_user_agent_len
  check (user_agent is null or char_length(user_agent) <= 200);

comment on column audit_views.user_agent is 'Coarse browser family ("Chrome, mobile") since 0006. Never the raw User-Agent.';
