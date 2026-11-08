import 'server-only';

import { AgencySettingsInputSchema, type AgencySettingsInput } from '@mynto/db';
import { cache } from 'react';

import { db, pgErrorCode } from './db';
import { getServerEnv } from './env';
import { iconLinks, type IconLinks } from './favicon';
import { logger } from './logger';

/** Agency identity shown on reports, the PDF, the OG image and the dashboard. */
export interface Branding {
  name: string;
  websiteUrl: string | null;
  websiteHost: string | null;
  contactUrl: string | null;
  /** /media/brand/logo?v=..., null without logo. */
  logoUrl: string | null;
  /** Favicon and touch icon links (agency favicon > logo > default icon). */
  icons: IconLinks;
  /** True when the agency uploaded its own favicon (Réglages > Marque). */
  hasCustomFavicon: boolean;
  /** Validated #RRGGBB. */
  primaryColor: string;
  footer: string | null;
  dailyRateEur: number | null;
  /** 'settings' once the Marque form was saved, 'env' before. */
  source: 'settings' | 'env';
}

export const DEFAULT_PRIMARY_COLOR = '#2563EB';

/**
 * First-boot defaults from AGENCY_* env vars, validated with the same
 * schema as the settings form. An invalid optional value is dropped (with a
 * warning) rather than breaking every report.
 */
export function envBrandingDefaults(): AgencySettingsInput {
  const env = getServerEnv();
  const raw = {
    name: env.AGENCY_NAME,
    website_url: env.AGENCY_WEBSITE_URL ?? null,
    contact_url: env.AGENCY_CONTACT_URL ?? null,
    primary_color: env.AGENCY_PRIMARY_COLOR ?? null,
    report_footer: env.AGENCY_REPORT_FOOTER ?? null,
    daily_rate_eur: null,
  };
  const parsed = AgencySettingsInputSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  logger.warn(
    { fields: parsed.error.issues.map((i) => i.path.join('.')) },
    'agency_env_defaults_invalid',
  );
  const fallback: AgencySettingsInput = { ...raw, contact_url: null, website_url: null };
  const again = AgencySettingsInputSchema.safeParse(fallback);
  return again.success
    ? again.data
    : {
        name: 'Mon agence',
        website_url: null,
        contact_url: null,
        primary_color: null,
        report_footer: null,
        daily_rate_eur: null,
      };
}

function hostOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function logoUrlFromKey(key: string | null): string | null {
  if (key === null) return null;
  const version = /logo-([a-z0-9]+)\./.exec(key)?.[1] ?? '0';
  return `/media/brand/logo?v=${version}`;
}

/** Branding of the install. Cached per request; falls back to env on DB error. */
export const getBranding = cache(async (): Promise<Branding> => {
  const defaults = envBrandingDefaults();
  let row: Awaited<ReturnType<ReturnType<typeof db>['settings']['get']>> = null;
  if (getServerEnv().DATABASE_URL !== undefined) {
    try {
      row = await db().settings.get();
    } catch (err) {
      logger.error({ code: pgErrorCode(err) }, 'agency_settings_read_failed');
    }
  }
  const v = row ?? { ...defaults, logo_key: null, favicon_key: null };
  return {
    name: v.name,
    websiteUrl: v.website_url,
    websiteHost: hostOf(v.website_url),
    contactUrl: v.contact_url,
    logoUrl: logoUrlFromKey(v.logo_key),
    icons: iconLinks({ favicon_key: v.favicon_key, logo_key: v.logo_key }),
    hasCustomFavicon: v.favicon_key !== null,
    primaryColor: v.primary_color ?? DEFAULT_PRIMARY_COLOR,
    footer: v.report_footer,
    dailyRateEur: v.daily_rate_eur,
    source: row === null ? 'env' : 'settings',
  };
});
