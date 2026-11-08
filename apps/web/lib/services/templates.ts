import 'server-only';

import type {
  ApiTemplate,
  ApiTemplatePreview,
  ApiTemplatePreviewBody,
  ApiTemplateSaveBody,
  ApiTemplateSaveResult,
  ApiTemplateSummary,
} from '@mynto/shared';
import {
  checkTemplateStatic,
  exampleReportData,
  isReservedTemplateId,
  defaultTemplate,
  reportDataJsonSchema,
  toDocument,
  validateBundleFiles,
  type TemplateBundle,
} from '@mynto/templates';

import { db, pgErrorCode } from '../db';
import { logger } from '../logger';
import { renderTemplatePreview } from '../reports/render';
import { listTemplates, loadTemplateBundle } from '../reports/templates';

import { ServiceError } from './audits';

/**
 * Report templates for the REST API and the MCP server. save_template only
 * stores a template that passes the static check (validation, render on the
 * example data in web and print modes, accessibility lint). Built-in
 * templates are read-only: duplicate them under another id.
 */

function summary(t: Awaited<ReturnType<typeof listTemplates>>[number]): ApiTemplateSummary {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    version: t.version,
    builtin: t.builtin,
    enabled: t.enabled,
    is_default: t.isDefault,
    based_on: t.basedOn,
  };
}

async function guard<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    logger.error({ code: pgErrorCode(err) }, what);
    throw new ServiceError('internal_error', 500, 'Erreur interne.');
  }
}

export async function listTemplatesApi(): Promise<ApiTemplateSummary[]> {
  return guard('api_templates_list_failed', async () => (await listTemplates()).map(summary));
}

export async function getTemplateApi(id: string): Promise<ApiTemplate> {
  return guard('api_template_get_failed', async () => {
    const all = await listTemplates();
    const entry = all.find((t) => t.id === id);
    const bundle = await loadTemplateBundle(id);
    if (!entry || !bundle) throw new ServiceError('not_found', 404, 'Modèle introuvable.');
    return {
      ...summary(entry),
      manifest: bundle.manifest,
      files: bundle.files,
      settings: entry.stored,
      has_preview: bundle.preview !== null,
    };
  });
}

export function reportDataSchemaApi(): { schema: Record<string, unknown>; example: unknown } {
  const std = defaultTemplate();
  return { schema: reportDataJsonSchema(), example: exampleReportData(std) };
}

function draftBundle(
  id: string,
  files: Record<string, string>,
  preview: string | null,
): {
  bundle: TemplateBundle | null;
  issues: ApiTemplatePreview['issues'];
} {
  const { manifest, issues } = validateBundleFiles(
    files,
    preview === null ? null : new Uint8Array(Buffer.from(preview, 'base64')),
  );
  if (manifest === null || issues.some((i) => i.level === 'error')) return { bundle: null, issues };
  if (manifest.id !== id) {
    return {
      bundle: null,
      issues: [
        {
          level: 'error',
          file: 'manifest.json',
          message: `l’id du manifest (${manifest.id}) doit être ${id}`,
        },
      ],
    };
  }
  return { bundle: { manifest, files, preview, builtin: false }, issues };
}

export async function previewTemplateApi(
  id: string,
  body: ApiTemplatePreviewBody,
): Promise<ApiTemplatePreview> {
  return guard('api_template_preview_failed', async () => {
    let bundle: TemplateBundle | null;
    let issues: ApiTemplatePreview['issues'] = [];
    if (body.files) {
      const d = draftBundle(id, body.files, null);
      bundle = d.bundle;
      issues = d.issues;
      if (bundle === null)
        throw new ServiceError(
          'invalid_template',
          422,
          issues
            .map((i) => `${i.file ?? ''} ${i.message}`)
            .join('; ')
            .slice(0, 900),
        );
    } else {
      bundle = await loadTemplateBundle(id);
    }
    if (bundle === null) throw new ServiceError('not_found', 404, 'Modèle introuvable.');
    let audit;
    if (body.audit_id) {
      const row = (await db().dashboard.listAudits({ ids: [body.audit_id], limit: 1 })).rows[0];
      if (row?.status !== 'completed')
        throw new ServiceError('not_found', 404, 'Audit terminé introuvable.');
      const a = await db().audits.getPublicBySlug(row.slug);
      if (a === null) throw new ServiceError('not_found', 404, 'Audit introuvable.');
      audit = { audit: a, findings: (await db().audits.listPublicFindingsBySlug(row.slug)) ?? [] };
    }
    const state = await db().reports.getState(id);
    const out = await renderTemplatePreview(
      bundle,
      body.settings ?? state?.settings ?? {},
      body.mode,
      audit,
    ).catch((err: unknown) => {
      throw new ServiceError(
        'render_failed',
        422,
        err instanceof Error ? err.message.slice(0, 500) : 'Rendu impossible.',
      );
    });
    return { html: toDocument(out, `Aperçu : ${bundle.manifest.name}`), issues };
  });
}

export async function saveTemplateApi(
  id: string,
  body: ApiTemplateSaveBody,
): Promise<ApiTemplateSaveResult> {
  return guard('api_template_save_failed', async () => {
    if (isReservedTemplateId(id)) {
      throw new ServiceError(
        'builtin_template',
        409,
        'Les modèles intégrés ne se modifient pas. Utilise un autre id.',
      );
    }
    const preview =
      body.preview_png_base64 && /^[A-Za-z0-9+/=]+$/.test(body.preview_png_base64)
        ? body.preview_png_base64
        : null;
    const d = draftBundle(id, body.files, preview);
    if (d.bundle === null) return { saved: false, created: false, issues: d.issues };
    const report = await checkTemplateStatic(d.bundle);
    if (!report.ok) return { saved: false, created: false, issues: report.issues };
    const res = await db().reports.upsertCustom({
      id,
      manifest: d.bundle.manifest,
      files: d.bundle.files,
      preview: d.bundle.preview,
    });
    logger.info({ template: id, created: res.created }, 'template_saved_via_api');
    return { saved: true, created: res.created, issues: report.issues };
  });
}
