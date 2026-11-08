import { z } from 'zod';

import { jsonb, type Sql } from '../client.js';

/**
 * Report settings (default template, fonts), custom templates and the
 * per-template state (enabled flag, settings values). Bundle contents are
 * validated by @mynto/templates before they reach these methods; the
 * repository only enforces shapes and sizes.
 */

export const TEMPLATE_ID_RE = /^[a-z][a-z0-9-]{1,39}$/;
const FONT_ID_RE = /^[a-z0-9-]{1,40}$/;
export const FONT_KEY_RE = /^fonts\/[a-z0-9]{8,32}\.woff2$/;

export interface ReportSettingsRow {
  default_template_id: string;
  heading_font: string;
  body_font: string;
  custom_font_name: string | null;
  custom_font_regular_key: string | null;
  custom_font_bold_key: string | null;
  updated_at: string | null;
}

export const DEFAULT_REPORT_SETTINGS: ReportSettingsRow = Object.freeze({
  default_template_id: 'minimal',
  heading_font: 'inter',
  body_font: 'inter',
  custom_font_name: null,
  custom_font_regular_key: null,
  custom_font_bold_key: null,
  updated_at: null,
});

export interface CustomTemplateRow {
  id: string;
  manifest: unknown;
  files: Record<string, string>;
  preview: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateStateRow {
  template_id: string;
  enabled: boolean;
  settings: Record<string, unknown>;
}

const FilesSchema = z.record(z.string().max(300_000)).refine((f) => Object.keys(f).length <= 40);

export function createReportsRepo(sql: Sql) {
  return {
    async getSettings(): Promise<ReportSettingsRow> {
      const [row] = await sql<ReportSettingsRow[]>`
        select default_template_id, heading_font, body_font, custom_font_name,
               custom_font_regular_key, custom_font_bold_key, updated_at
          from report_settings where id
      `;
      return row ?? { ...DEFAULT_REPORT_SETTINGS };
    },

    async setDefaultTemplate(id: string): Promise<void> {
      if (!TEMPLATE_ID_RE.test(id)) throw new Error('invalid template id');
      await sql`
        insert into report_settings (id, default_template_id) values (true, ${id})
        on conflict (id) do update set default_template_id = excluded.default_template_id, updated_at = now()
      `;
    },

    async setFonts(heading: string, body: string): Promise<void> {
      if (!FONT_ID_RE.test(heading) || !FONT_ID_RE.test(body)) throw new Error('invalid font id');
      await sql`
        insert into report_settings (id, heading_font, body_font) values (true, ${heading}, ${body})
        on conflict (id) do update set heading_font = excluded.heading_font,
          body_font = excluded.body_font, updated_at = now()
      `;
    },

    /**
     * Sets (or clears, with nulls) the custom font. Returns the previous keys
     * so the caller deletes the old files.
     */
    async setCustomFont(input: {
      name: string | null;
      regularKey: string | null;
      boldKey: string | null;
    }): Promise<{ previous: string[] }> {
      for (const k of [input.regularKey, input.boldKey]) {
        if (k !== null && !FONT_KEY_RE.test(k)) throw new Error('invalid font key');
      }
      if (input.name !== null && (input.name.length < 1 || input.name.length > 40)) {
        throw new Error('invalid font name');
      }
      return sql.begin(async (tx) => {
        const [prev] = await tx<
          { custom_font_regular_key: string | null; custom_font_bold_key: string | null }[]
        >`select custom_font_regular_key, custom_font_bold_key from report_settings where id for update`;
        await tx`
          insert into report_settings (id, custom_font_name, custom_font_regular_key, custom_font_bold_key)
          values (true, ${input.name}, ${input.regularKey}, ${input.boldKey})
          on conflict (id) do update set custom_font_name = excluded.custom_font_name,
            custom_font_regular_key = excluded.custom_font_regular_key,
            custom_font_bold_key = excluded.custom_font_bold_key, updated_at = now()
        `;
        const previous = [prev?.custom_font_regular_key, prev?.custom_font_bold_key].filter(
          (k): k is string =>
            typeof k === 'string' && k !== input.regularKey && k !== input.boldKey,
        );
        return { previous };
      });
    },

    async listCustom(): Promise<CustomTemplateRow[]> {
      return sql<CustomTemplateRow[]>`
        select id, manifest, files, preview, created_at, updated_at
          from report_templates order by created_at asc
      `;
    },

    async getCustom(id: string): Promise<CustomTemplateRow | null> {
      if (!TEMPLATE_ID_RE.test(id)) return null;
      const [row] = await sql<CustomTemplateRow[]>`
        select id, manifest, files, preview, created_at, updated_at
          from report_templates where id = ${id}
      `;
      return row ?? null;
    },

    /** Creates or replaces a custom template. */
    async upsertCustom(input: {
      id: string;
      manifest: unknown;
      files: Record<string, string>;
      preview: string | null;
    }): Promise<{ created: boolean }> {
      if (!TEMPLATE_ID_RE.test(input.id)) throw new Error('invalid template id');
      const files = FilesSchema.parse(input.files);
      if (input.preview !== null && input.preview.length > 1_400_000)
        throw new Error('preview too large');
      const [row] = await sql<{ created: boolean }[]>`
        insert into report_templates (id, manifest, files, preview)
        values (${input.id}, ${jsonb(sql, input.manifest)}, ${jsonb(sql, files)}, ${input.preview})
        on conflict (id) do update set manifest = excluded.manifest, files = excluded.files,
          preview = excluded.preview, updated_at = now()
        returning (xmax = 0) as created
      `;
      return { created: row?.created ?? false };
    },

    /** Deletes a custom template, its state, and points its audits back to the default. */
    async deleteCustom(id: string): Promise<boolean> {
      if (!TEMPLATE_ID_RE.test(id)) return false;
      return sql.begin(async (tx) => {
        const res = await tx`delete from report_templates where id = ${id}`;
        await tx`delete from report_template_state where template_id = ${id}`;
        await tx`update audits_full set template_id = null where template_id = ${id}`;
        await tx`
          update report_settings set default_template_id = 'minimal', updated_at = now()
           where default_template_id = ${id}
        `;
        return res.count > 0;
      });
    },

    async listStates(): Promise<TemplateStateRow[]> {
      return sql<TemplateStateRow[]>`
        select template_id, enabled, settings from report_template_state
      `;
    },

    async getState(id: string): Promise<TemplateStateRow | null> {
      if (!TEMPLATE_ID_RE.test(id)) return null;
      const [row] = await sql<TemplateStateRow[]>`
        select template_id, enabled, settings from report_template_state where template_id = ${id}
      `;
      return row ?? null;
    },

    async setEnabled(id: string, enabled: boolean): Promise<void> {
      if (!TEMPLATE_ID_RE.test(id)) throw new Error('invalid template id');
      await sql`
        insert into report_template_state (template_id, enabled) values (${id}, ${enabled})
        on conflict (template_id) do update set enabled = excluded.enabled, updated_at = now()
      `;
    },

    /** Replaces the settings values (already sanitized against the manifest). */
    async saveTemplateSettings(id: string, settings: Record<string, unknown>): Promise<void> {
      if (!TEMPLATE_ID_RE.test(id)) throw new Error('invalid template id');
      await sql`
        insert into report_template_state (template_id, settings) values (${id}, ${jsonb(sql, settings)})
        on conflict (template_id) do update set settings = excluded.settings, updated_at = now()
      `;
    },

    async resetTemplateSettings(id: string): Promise<void> {
      await sql`
        update report_template_state set settings = '{}'::jsonb, updated_at = now()
         where template_id = ${id}
      `;
    },

    /** Template of an audit (null = install default). */
    async setAuditTemplate(auditId: string, templateId: string | null): Promise<number> {
      if (templateId !== null && !TEMPLATE_ID_RE.test(templateId))
        throw new Error('invalid template id');
      const res =
        await sql`update audits_full set template_id = ${templateId} where id = ${auditId}`;
      return res.count;
    },

    /** Report rendering metadata, by slug (non-expired). Server-side only. */
    async getReportMetaBySlug(slug: string): Promise<{
      id: string;
      template_id: string | null;
      favicon_key: string | null;
    } | null> {
      const [row] = await sql<
        { id: string; template_id: string | null; favicon_key: string | null }[]
      >`
        select id, template_id, favicon_key from audits_full
         where slug = ${slug} and expires_at > now()
      `;
      return row ?? null;
    },
  };
}

export type ReportsRepo = ReturnType<typeof createReportsRepo>;
