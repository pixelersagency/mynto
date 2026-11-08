-- Report templates v2: the built-in templates standard, compact and commercial
-- are replaced by minimal (Minimaliste, the new default), bento and mynto
-- (Style Mynto). Stored ids are rewritten so existing audits and settings keep
-- rendering:
--   standard   -> minimal
--   compact    -> minimal
--   commercial -> mynto
-- The app also resolves the old ids in code (LEGACY_TEMPLATE_ALIASES in
-- @mynto/templates), so nothing breaks between deploy and migration.
--
-- 0001 to 0009 are never edited. No new table: nothing to secure.

-- 1. A custom template that already uses a new built-in id would be shadowed
--    by the built-in one: it moves to "<id>-perso" (or "<id>-perso-<n>").
do $$
declare
  old_id text;
  new_id text;
  n int;
begin
  foreach old_id in array array['minimal', 'bento', 'mynto'] loop
    if exists (select 1 from report_templates where id = old_id) then
      new_id := old_id || '-perso';
      n := 2;
      while exists (select 1 from report_templates where id = new_id) loop
        new_id := old_id || '-perso-' || n;
        n := n + 1;
      end loop;
      update report_templates
         set id = new_id, manifest = jsonb_set(manifest, '{id}', to_jsonb(new_id)), updated_at = now()
       where id = old_id;
      update report_template_state set template_id = new_id where template_id = old_id;
      update audits_full set template_id = new_id where template_id = old_id;
      update report_settings set default_template_id = new_id where default_template_id = old_id;
    end if;
  end loop;
end $$;

-- 2. Saved settings and enabled flag move to the new id. Setting keys are
--    shared (sections, texts, open_issues, show_code, fonts...); keys the new
--    template does not declare are ignored at render. For minimal, the old
--    default template wins, then standard, then compact.
insert into report_template_state (template_id, enabled, settings, updated_at)
select 'mynto', enabled, settings, now()
  from report_template_state
 where template_id = 'commercial'
on conflict (template_id) do nothing;

insert into report_template_state (template_id, enabled, settings, updated_at)
select 'minimal', s.enabled, s.settings, now()
  from report_template_state s
  left join report_settings r on r.id
 where s.template_id in ('standard', 'compact')
 order by (s.template_id = r.default_template_id) desc nulls last,
          (s.template_id = 'standard') desc
 limit 1
on conflict (template_id) do nothing;

delete from report_template_state where template_id in ('standard', 'compact', 'commercial');

-- 3. Audits pinned to an old template.
update audits_full set template_id = 'minimal' where template_id in ('standard', 'compact');
update audits_full set template_id = 'mynto' where template_id = 'commercial';

-- 4. Install default.
update report_settings
   set default_template_id = case default_template_id when 'commercial' then 'mynto' else 'minimal' end,
       updated_at = now()
 where default_template_id in ('standard', 'compact', 'commercial');

alter table report_settings alter column default_template_id set default 'minimal';
