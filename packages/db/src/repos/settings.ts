import {
  AuditModulesSchema,
  DEFAULT_AUDIT_MODULES,
  parseStoredModules,
  type AuditModules,
} from '@mynto/shared';
import { z } from 'zod';

import { jsonb, type Sql } from '../client.js';

/**
 * agency_settings: branding of the install (single row). Before the first
 * save there is no row and callers fall back to their env defaults.
 */

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
export const LOGO_KEY_PATTERN = /^brand\/logo-[a-z0-9]{8,32}\.(png|jpg)$/;
/** Mirrors the CHECK constraint of migration 0011. */
export const FAVICON_KEY_PATTERN = /^brand\/favicon-[a-z0-9]{8,32}\.(png|svg|ico)$/;

function optionalUrl(schemes: RegExp, max = 300) {
  return z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .string()
      .trim()
      .max(max)
      .refine((v) => {
        if (!schemes.test(v)) return false;
        if (v.startsWith('mailto:')) return /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        try {
          const u = new URL(v);
          return u.hostname.length > 0;
        } catch {
          return false;
        }
      }, 'URL invalide')
      .nullable(),
  );
}

/**
 * Validation of the editable fields (dashboard "Marque" form and env
 * defaults). Mirrors the CHECK constraints of migration 0002.
 */
export const AgencySettingsInputSchema = z.object({
  name: z.string().trim().min(1, 'Indique un nom').max(80, '80 caractères maximum'),
  website_url: optionalUrl(/^https?:\/\//),
  contact_url: optionalUrl(/^(https?:\/\/|mailto:)/),
  primary_color: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().regex(HEX_COLOR, 'Couleur au format #RRGGBB').nullable(),
  ),
  report_footer: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(500, '500 caractères maximum').nullable(),
  ),
  daily_rate_eur: z.preprocess(
    (v) => (v === '' || v === undefined ? null : typeof v === 'string' ? Number(v) : v),
    z
      .number({ invalid_type_error: 'Nombre entier attendu' })
      .int('Nombre entier attendu')
      .min(0, 'Entre 0 et 10 000')
      .max(10_000, 'Entre 0 et 10 000')
      .nullable(),
  ),
});
export type AgencySettingsInput = z.infer<typeof AgencySettingsInputSchema>;

export interface AgencySettingsRow extends AgencySettingsInput {
  logo_key: string | null;
  /** Uploaded favicon (migration 0011); null = use the logo, then the default icon. */
  favicon_key: string | null;
  updated_at: string;
}

type MediaColumn = 'logo_key' | 'favicon_key';

const MEDIA_KEY_PATTERNS: Record<MediaColumn, RegExp> = {
  logo_key: LOGO_KEY_PATTERN,
  favicon_key: FAVICON_KEY_PATTERN,
};

export function createSettingsRepo(sql: Sql) {
  /**
   * Sets (or clears) one media key column. `defaults` creates the row when
   * the agency uploads a file before ever saving the form. Returns the
   * previous key so the caller can delete the old file.
   */
  async function setMediaKey(
    column: MediaColumn,
    key: string | null,
    defaults: AgencySettingsInput,
  ): Promise<{ previous: string | null }> {
    if (key !== null && !MEDIA_KEY_PATTERNS[column].test(key)) {
      throw new Error(`invalid ${column}`);
    }
    return sql.begin(async (tx) => {
      const [prev] = await tx<{ previous: string | null }[]>`
        select ${tx(column)} as previous from agency_settings where id for update
      `;
      if (prev === undefined) {
        const v = AgencySettingsInputSchema.parse(defaults);
        await tx`
          insert into agency_settings
            (id, name, website_url, contact_url, primary_color, report_footer, daily_rate_eur,
             ${tx(column)})
          values (true, ${v.name}, ${v.website_url}, ${v.contact_url}, ${v.primary_color},
                  ${v.report_footer}, ${v.daily_rate_eur}, ${key})
          on conflict (id) do update set ${tx(column)} = excluded.${tx(column)}, updated_at = now()
        `;
        return { previous: null };
      }
      await tx`update agency_settings set ${tx(column)} = ${key}, updated_at = now() where id`;
      return { previous: prev.previous };
    });
  }

  return {
    async get(): Promise<AgencySettingsRow | null> {
      const [row] = await sql<AgencySettingsRow[]>`
        select name, website_url, contact_url, logo_key, favicon_key, primary_color,
               report_footer, daily_rate_eur, updated_at
          from agency_settings where id
      `;
      return row ?? null;
    },

    /** Creates or replaces the editable fields (the logo and favicon keys are kept). */
    async save(input: AgencySettingsInput): Promise<AgencySettingsRow> {
      const v = AgencySettingsInputSchema.parse(input);
      const [row] = await sql<AgencySettingsRow[]>`
        insert into agency_settings
          (id, name, website_url, contact_url, primary_color, report_footer, daily_rate_eur)
        values (true, ${v.name}, ${v.website_url}, ${v.contact_url}, ${v.primary_color},
                ${v.report_footer}, ${v.daily_rate_eur})
        on conflict (id) do update set
          name = excluded.name,
          website_url = excluded.website_url,
          contact_url = excluded.contact_url,
          primary_color = excluded.primary_color,
          report_footer = excluded.report_footer,
          daily_rate_eur = excluded.daily_rate_eur,
          updated_at = now()
        returning name, website_url, contact_url, logo_key, favicon_key, primary_color,
                  report_footer, daily_rate_eur, updated_at
      `;
      if (row === undefined) throw new Error('agency_settings upsert returned no row');
      return row;
    },

    /** Sets (or clears) the logo key; returns the previous one. */
    async setLogoKey(
      key: string | null,
      defaults: AgencySettingsInput,
    ): Promise<{ previous: string | null }> {
      return setMediaKey('logo_key', key, defaults);
    },

    /** Sets (or clears) the favicon key; returns the previous one. */
    async setFaviconKey(
      key: string | null,
      defaults: AgencySettingsInput,
    ): Promise<{ previous: string | null }> {
      return setMediaKey('favicon_key', key, defaults);
    },
  };
}

export type SettingsRepo = ReturnType<typeof createSettingsRepo>;

/** audit_settings: install-level default modules (single row, absent = all enabled). */
export function createAuditSettingsRepo(sql: Sql) {
  return {
    async getModules(): Promise<AuditModules> {
      const [row] = await sql<{ modules: unknown }[]>`select modules from audit_settings where id`;
      return row === undefined ? { ...DEFAULT_AUDIT_MODULES } : parseStoredModules(row.modules);
    },

    async saveModules(modules: AuditModules): Promise<AuditModules> {
      const v = AuditModulesSchema.parse(modules);
      await sql`
        insert into audit_settings (id, modules) values (true, ${jsonb(sql, v)})
        on conflict (id) do update set modules = excluded.modules, updated_at = now()
      `;
      return v;
    },
  };
}

export type AuditSettingsRepo = ReturnType<typeof createAuditSettingsRepo>;
