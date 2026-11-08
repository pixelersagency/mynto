import 'server-only';

import type { AuditFullFinding, AuditFullResult } from '@mynto/shared';
import {
  buildReportData,
  EXAMPLE_AUDIT,
  EXAMPLE_FINDINGS,
  renderTemplate,
  resolveSettings,
  defaultTemplate,
  TemplateRenderError,
  type RenderResult,
  type ReportDataV1,
  type TemplateBundle,
} from '@mynto/templates';

import { fontChoice, resolveTemplate } from './templates';

import { getBranding, type Branding } from '@/lib/branding';
import { db, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';

/**
 * One rendering path for the web report (/audit/full, /r/), the PDF page and
 * the dashboard previews: report-data v1 built from the audit, then the
 * template engine. A broken custom template falls back to Minimaliste (the default).
 */

function agencyOf(brand: Branding) {
  return {
    name: brand.name,
    websiteUrl: brand.websiteUrl,
    contactUrl: brand.contactUrl,
    logoUrl: brand.logoUrl,
    color: brand.primaryColor,
    footer: brand.footer,
  };
}

export interface RenderAuditInput {
  audit: AuditFullResult;
  findings: AuditFullFinding[];
  mode: 'web' | 'print';
  shareUrl: string;
  tracking: boolean;
}

export async function renderAuditReport(
  input: RenderAuditInput,
): Promise<RenderResult & { data: ReportDataV1 }> {
  const brand = await getBranding();
  let meta: { template_id: string | null; favicon_key: string | null } | null = null;
  try {
    meta = await db().reports.getReportMetaBySlug(input.audit.slug);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'report_meta_read_failed');
  }
  const resolved = await resolveTemplate(meta?.template_id ?? null);
  const fonts = await fontChoice();
  const build = (bundle: TemplateBundle, values = resolved.values, sections = resolved.sections) =>
    buildReportData({
      audit: input.audit,
      findings: input.findings,
      agency: agencyOf(brand),
      context: {
        mode: input.mode,
        shareUrl: input.shareUrl,
        pdfUrl: `/api/audits/full/${input.audit.slug}/pdf`,
        tracking: input.tracking,
        faviconUrl: meta?.favicon_key ? `/media/${meta.favicon_key}` : null,
      },
      template: {
        id: bundle.manifest.id,
        name: bundle.manifest.name,
        version: bundle.manifest.version,
        values,
        sections,
      },
    });
  const data = build(resolved.bundle);
  try {
    return { ...(await renderTemplate(resolved.bundle, data, { fonts })), data };
  } catch (err) {
    logger.error(
      {
        template: resolved.bundle.manifest.id,
        err: err instanceof TemplateRenderError ? err.message.slice(0, 200) : 'unknown',
      },
      'report_template_render_failed',
    );
    const std = defaultTemplate();
    const r = resolveSettings(std.manifest, {});
    const fallback = build(std, r.values, r.sections);
    return { ...(await renderTemplate(std, fallback, { fonts })), data: fallback };
  }
}

/** Template preview on the example audit, with the agency's real branding. */
export async function renderTemplatePreview(
  bundle: TemplateBundle,
  stored: Record<string, unknown>,
  mode: 'web' | 'print' = 'web',
  audit?: { audit: AuditFullResult; findings: AuditFullFinding[] },
): Promise<RenderResult> {
  const brand = await getBranding();
  const { values, sections } = resolveSettings(bundle.manifest, stored);
  const data = buildReportData({
    audit: audit?.audit ?? EXAMPLE_AUDIT,
    findings: audit?.findings ?? EXAMPLE_FINDINGS,
    agency: agencyOf(brand),
    context: {
      mode,
      shareUrl: 'https://exemple.fr/r/apercu',
      pdfUrl: '#apercu',
      tracking: true,
      label: audit ? null : 'Boulangerie Martin',
    },
    template: {
      id: bundle.manifest.id,
      name: bundle.manifest.name,
      version: bundle.manifest.version,
      values,
      sections,
    },
  });
  return renderTemplate(bundle, data, { fonts: await fontChoice() });
}
