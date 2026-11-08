-- Agency favicon (Réglages > Marque). Optional: without it the instance uses
-- the agency logo, then the default Mynto icon (apps/web/lib/favicon.ts).
--
-- Media key of the uploaded favicon (brand/favicon-<random>.png|svg|ico),
-- stored next to the logo in MEDIA_DIR and served by /media/brand/favicon.
-- The SVG is checked at upload (no script, no event handler, no external
-- reference) and served with a sandbox CSP.
--
-- 0001 to 0010 are never edited. Additive only.

alter table agency_settings
  add column favicon_key text
    constraint agency_settings_favicon_key_check
    check (favicon_key is null or favicon_key ~ '^brand/favicon-[a-z0-9]{8,32}\.(png|svg|ico)$');
