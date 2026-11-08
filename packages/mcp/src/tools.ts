import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  AiSiteTypeInputSchema,
  ALL_AXES,
  ApiAuditStatusFilterSchema,
  AuditAxisSchema,
  WEBHOOK_EVENT_TYPES,
  WebhookEventTypeSchema,
  type ApiAnalyticsSummary,
  type ApiAudit,
  type ApiAuditList,
  type ApiCreateAuditBody,
  type ApiFinding,
  type ApiListAuditsQuery,
  type ApiTemplate,
  type ApiTemplatePreview,
  type ApiTemplatePreviewBody,
  type ApiTemplateSaveBody,
  type ApiTemplateSaveResult,
  type ApiTemplateSummary,
  type ApiWebhook,
  type ApiWebhookCreateBody,
  type ApiWebhookTestResult,
  type ApiWebhookWithSecret,
} from '@mynto/shared';
import { z } from 'zod';

/**
 * MCP tools of a mynto install. The same definitions serve both transports:
 *   - Streamable HTTP at /mcp on the web app, backed by the service layer;
 *   - stdio (mynto-mcp bin), backed by the REST API v1.
 * The tools are thin wrappers: every rule (validation of the URL, modules,
 * rate limits, what is exposed) lives in the backend, not here.
 */

export interface MyntoBackend {
  createAudit(input: ApiCreateAuditBody): Promise<ApiAudit>;
  listAudits(query: ApiListAuditsQuery): Promise<ApiAuditList>;
  getAudit(id: string): Promise<ApiAudit>;
  getFindings(id: string): Promise<ApiFinding[]>;
  refreshAudit(id: string): Promise<{ audit: ApiAudit; refreshed: boolean; reason?: string }>;
  analyticsSummary(days: number): Promise<ApiAnalyticsSummary>;
  listTemplates(): Promise<ApiTemplateSummary[]>;
  getTemplate(id: string): Promise<ApiTemplate>;
  reportDataSchema(): Promise<{ schema: Record<string, unknown>; example: unknown }>;
  previewTemplate(id: string, body: ApiTemplatePreviewBody): Promise<ApiTemplatePreview>;
  saveTemplate(id: string, body: ApiTemplateSaveBody): Promise<ApiTemplateSaveResult>;
  listWebhooks(): Promise<ApiWebhook[]>;
  createWebhook(body: ApiWebhookCreateBody): Promise<ApiWebhookWithSecret>;
  testWebhook(id: string): Promise<ApiWebhookTestResult>;
}

/** Error carrying the API error code, rendered as a tool error (not a protocol error). */
export class MyntoToolError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'MyntoToolError';
    this.code = code;
  }
}

export const TOOL_NAMES = [
  'create_audit',
  'list_audits',
  'get_audit',
  'get_findings',
  'refresh_audit',
  'get_report_link',
  'get_analytics_summary',
  'list_templates',
  'get_template',
  'get_report_data_schema',
  'preview_template',
  'save_template',
  'list_webhooks',
  'create_webhook',
  'test_webhook',
] as const;

const templateId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{1,39}$/)
  .describe('Template id: lowercase letters, digits and dashes (e.g. "minimal", "agence-sobre").');

const templateFiles = z
  .record(z.string().max(300_000))
  .describe(
    'Template files keyed by path: manifest.json, report.liquid, sections/<name>.liquid, partials/<name>.liquid, report.css, print.css. Liquid (no code), CSS without @import, url() or @font-face.',
  );

const auditId = z
  .string()
  .uuid()
  .describe('Audit id (UUID) returned by create_audit or list_audits.');

const modulesShape = z
  .object({
    axes: z
      .array(AuditAxisSchema)
      .min(1)
      .max(ALL_AXES.length)
      .optional()
      .describe(
        `Axes to evaluate. Any of: ${ALL_AXES.join(', ')}. Omit to use the install defaults.`,
      ),
    lighthouse: z.boolean().optional().describe('Run Lighthouse (performance, accessibility).'),
    vision: z
      .boolean()
      .optional()
      .describe('Screenshot analysis by the vision model (UI, UX, conversion).'),
    hero: z.boolean().optional().describe('Hero screenshot at the top of the report.'),
    narrative: z.boolean().optional().describe('LLM-written summary and recommendations.'),
    ai_readiness: z
      .boolean()
      .optional()
      .describe(
        'Run the AI readiness module ("Préparation IA"): 24 deterministic tests on how AI agents find, read and use the site (llms.txt, AI bot rules in robots.txt, Markdown, MCP/A2A/OAuth discovery, agentic commerce). Separate score /100.',
      ),
    site_type: AiSiteTypeInputSchema.optional().describe(
      'Site type of the AI readiness tests: auto (detected), vitrine, contenu, app_api, ecommerce.',
    ),
  })
  .strict();

const siteTypeParam = AiSiteTypeInputSchema.optional().describe(
  'Site type for the AI readiness tests: auto (detected from the home page, default), vitrine (showcase: no API or commerce tests), contenu (blog, media, docs), app_api (SaaS, API) or ecommerce (shop). Only used when the ai_readiness module runs.',
);

function json(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent:
      typeof value === 'object' && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : { result: value },
  };
}

function fail(err: unknown): CallToolResult {
  const code = err instanceof MyntoToolError ? err.code : 'internal';
  const message =
    err instanceof MyntoToolError ? err.message : 'Unexpected error while calling mynto.';
  return { isError: true, content: [{ type: 'text', text: `${code}: ${message}` }] };
}

async function run(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return json(await fn());
  } catch (err) {
    return fail(err);
  }
}

export function registerMyntoTools(server: McpServer, backend: MyntoBackend): void {
  server.registerTool(
    'create_audit',
    {
      title: 'Create a website audit',
      description:
        'Starts an audit of a website (8 axes: technical SEO, content SEO, performance, accessibility, legal compliance, conversion, UX, UI), ' +
        'plus the optional AI readiness module (modules.ai_readiness, site_type). ' +
        'Returns immediately with status "queued"; the scan takes 2 to 5 minutes. Poll get_audit until status is "completed" or "failed". ' +
        'The result includes the public report URL and a tracking link that tells the agency when the prospect opens it.',
      inputSchema: {
        url: z
          .string()
          .min(1)
          .max(2048)
          .describe(
            'Website to audit, e.g. "https://example.com". "https://" is added when missing.',
          ),
        label: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe('Optional client name or reference, visible only to the agency.'),
        modules: modulesShape.optional().describe('Optional override of the default modules.'),
        site_type: siteTypeParam,
        template: templateId
          .optional()
          .describe('Report template id (see list_templates). Omit for the install default.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) =>
      run(() =>
        backend.createAudit({
          url: args.url,
          ...(args.label !== undefined ? { label: args.label } : {}),
          ...(args.modules !== undefined ? { modules: args.modules } : {}),
          ...(args.site_type !== undefined ? { site_type: args.site_type } : {}),
          ...(args.template !== undefined ? { template: args.template } : {}),
        }),
      ),
  );

  server.registerTool(
    'list_audits',
    {
      title: 'List audits',
      description:
        'Lists the current audits, newest first, with status, score /100 (over evaluated axes), report and tracking links. ' +
        'Paginate with limit and offset. Filter by status or by a text match on URL or label.',
      inputSchema: {
        status: ApiAuditStatusFilterSchema.optional().describe(
          'in_progress, completed, failed or expired.',
        ),
        q: z.string().max(200).optional().describe('Case-insensitive search on URL or label.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe('Page size, 1-100 (default 25).'),
        offset: z.number().int().min(0).optional().describe('Items to skip (default 0).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      run(() =>
        backend.listAudits({
          limit: args.limit ?? 25,
          offset: args.offset ?? 0,
          ...(args.status !== undefined ? { status: args.status } : {}),
          ...(args.q !== undefined && args.q.trim() !== '' ? { q: args.q.trim() } : {}),
        }),
      ),
  );

  server.registerTool(
    'get_audit',
    {
      title: 'Get an audit',
      description:
        'Status, global score /100 and per-axis scores of one audit. Axes disabled for this audit are marked evaluated=false ' +
        '("not evaluated"), never scored 0. ai_readiness holds the AI readiness score /100, level, site type and the result of each of the 24 tests ' +
        '(evaluated=false when the module was off). After a refresh, an old id resolves to the current scan.',
      inputSchema: { id: auditId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => run(() => backend.getAudit(args.id)),
  );

  server.registerTool(
    'get_findings',
    {
      title: 'Get audit findings',
      description:
        'Problems found by a completed audit, most severe first (P0 critical to P3 minor), with axis, affected URLs and recommendation. ' +
        'Failed AI readiness tests are included with axis "ia" and rule_code "ia.<test>".',
      inputSchema: { id: auditId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => run(async () => ({ findings: await backend.getFindings(args.id) })),
  );

  server.registerTool(
    'refresh_audit',
    {
      title: 'Re-run an audit',
      description:
        'Rescans the site of an audit with the same modules. The public report URL and the tracking link stay the same and point to the new scan. ' +
        'Does nothing while a scan is already running.',
      inputSchema: { id: auditId },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args) => run(() => backend.refreshAudit(args.id)),
  );

  server.registerTool(
    'get_report_link',
    {
      title: 'Get the links of a report',
      description:
        'Returns the tracking link to send to the prospect (counts openings) and the direct report URL (for the agency, never counted).',
      inputSchema: { id: auditId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      run(async () => {
        const a = await backend.getAudit(args.id);
        return {
          id: a.id,
          status: a.status,
          tracking_url: a.tracking_url,
          report_url: a.report_url,
          opened: a.views_count > 0,
          last_viewed_at: a.last_viewed_at,
        };
      }),
  );

  server.registerTool(
    'get_analytics_summary',
    {
      title: 'Get analytics',
      description:
        'Activity over the last 7, 30 or 90 days: audits by status and week, average score per axis, score bands, ' +
        'tracking link open rate and median time to first open, most frequent findings, sources, LLM usage, ' +
        'and AI readiness (average score, audits under 50, most failed tests).',
      inputSchema: {
        days: z
          .union([z.literal(7), z.literal(30), z.literal(90)])
          .optional()
          .describe('Period in days (default 30).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => run(() => backend.analyticsSummary(args.days ?? 30)),
  );

  server.registerTool(
    'list_templates',
    {
      title: 'List report templates',
      description:
        'Report templates of the install: built-in ones (minimal, bento, mynto, read-only) and the agency ones, with enabled and default flags. ' +
        'The same template renders the web report and the PDF.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(async () => ({ templates: await backend.listTemplates() })),
  );

  server.registerTool(
    'get_template',
    {
      title: 'Get a report template',
      description:
        'Manifest, every file (Liquid, CSS) and the stored settings of a template. Start from a built-in one to create your own: copy its files, change manifest.id, edit, then save_template.',
      inputSchema: { id: templateId },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) => run(() => backend.getTemplate(args.id)),
  );

  server.registerTool(
    'get_report_data_schema',
    {
      title: 'Get the report data contract',
      description:
        'JSON Schema of report-data v1, the only object a template receives (scores on 100, axes, findings, AI readiness, cost, agency, texts, settings), plus a complete example. ' +
        'Every key is always present: use null checks, not existence checks.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(() => backend.reportDataSchema()),
  );

  server.registerTool(
    'preview_template',
    {
      title: 'Preview a report template',
      description:
        'Renders a template as a complete HTML document, on a real audit (audit_id) or the example audit. ' +
        'Pass draft files to try changes without saving. mode "print" shows the PDF layout (sections expanded, cover page).',
      inputSchema: {
        id: templateId,
        audit_id: z
          .string()
          .uuid()
          .optional()
          .describe('Completed audit to render (default: example data).'),
        mode: z.enum(['web', 'print']).optional().describe('web (default) or print (PDF layout).'),
        settings: z
          .record(z.unknown())
          .optional()
          .describe('Settings values to try, keyed like the manifest settings.'),
        files: templateFiles.optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      run(() =>
        backend.previewTemplate(args.id, {
          mode: args.mode ?? 'web',
          ...(args.audit_id !== undefined ? { audit_id: args.audit_id } : {}),
          ...(args.settings !== undefined ? { settings: args.settings } : {}),
          ...(args.files !== undefined ? { files: args.files } : {}),
        }),
      ),
  );

  server.registerTool(
    'save_template',
    {
      title: 'Save a report template',
      description:
        'Creates or replaces an agency template. It is saved only if it passes the check: allowed files, valid manifest, no script or remote resource, ' +
        'render without error on the example data in web and print modes, one h1, alt texts, named links and buttons. ' +
        'Returns saved=false with the issues otherwise. Built-in ids are refused. Run pnpm template:check locally for the full axe-core and PDF check.',
      inputSchema: {
        id: templateId,
        files: templateFiles,
        preview_png_base64: z
          .string()
          .max(1_400_000)
          .optional()
          .describe('Optional preview.png (base64).'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) =>
      run(() =>
        backend.saveTemplate(args.id, {
          files: args.files,
          ...(args.preview_png_base64 !== undefined
            ? { preview_png_base64: args.preview_png_base64 }
            : {}),
        }),
      ),
  );
  server.registerTool(
    'list_webhooks',
    {
      title: 'List webhooks',
      description:
        'Outgoing webhooks of the install: URL, subscribed events, active flag, last delivery status, failure streak ' +
        '(an endpoint is switched off after 20 final failures in a row). Secrets are never returned.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => run(async () => ({ webhooks: await backend.listWebhooks() })),
  );

  server.registerTool(
    'create_webhook',
    {
      title: 'Create a webhook',
      description:
        'Registers an HTTPS URL (n8n, Make, Zapier, CRM...) that receives a signed POST for each chosen event. ' +
        `Events: ${WEBHOOK_EVENT_TYPES.join(', ')}. ` +
        'The signing secret (whsec_...) is returned ONCE in this answer: store it on the receiving side. ' +
        'Requests carry X-Mynto-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<raw body>">. Private addresses are refused unless the install sets WEBHOOKS_ALLOW_PRIVATE=1.',
      inputSchema: {
        url: z.string().min(1).max(2048).describe('HTTPS URL receiving the POST requests.'),
        events: z
          .array(WebhookEventTypeSchema)
          .min(1)
          .describe('Event types to receive, at least one.'),
        description: z
          .string()
          .min(1)
          .max(120)
          .optional()
          .describe('Free note, e.g. "n8n relances".'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) =>
      run(() =>
        backend.createWebhook({
          url: args.url,
          events: args.events,
          ...(args.description !== undefined ? { description: args.description } : {}),
        }),
      ),
  );

  server.registerTool(
    'test_webhook',
    {
      title: 'Send a test ping to a webhook',
      description:
        'Queues a "ping" event for one webhook (delivered within a few seconds, even when the endpoint is switched off). ' +
        'Check the result with list_webhooks (last_status, last_status_code).',
      inputSchema: {
        id: z.string().uuid().describe('Webhook id from list_webhooks or create_webhook.'),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => run(() => backend.testWebhook(args.id)),
  );
}
