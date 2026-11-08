import 'server-only';

import { MyntoToolError, type MyntoBackend } from '@mynto/mcp';
import {
  ApiCreateAuditBodySchema,
  ApiTemplatePreviewBodySchema,
  ApiTemplateSaveBodySchema,
  ApiWebhookCreateBodySchema,
} from '@mynto/shared';

import {
  ServiceError,
  analyticsSummary,
  createAudit,
  getAudit,
  getFindings,
  listAudits,
  refreshAudit,
  type AuditSourceOfCall,
} from './audits';
import {
  getTemplateApi,
  listTemplatesApi,
  previewTemplateApi,
  reportDataSchemaApi,
  saveTemplateApi,
} from './templates';
import { createWebhook, listWebhooks, testWebhook } from './webhooks';

/** Errors keep their API code; anything else becomes a generic tool error. */
async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ServiceError) throw new MyntoToolError(err.code, err.message);
    throw err;
  }
}

/** MCP backend bound to the service layer (same rules as the REST API). */
export function serviceBackend(source: AuditSourceOfCall): MyntoBackend {
  return {
    createAudit: (input) =>
      wrap(() => {
        // Same normalisation and checks as POST /api/v1/audits.
        const parsed = ApiCreateAuditBodySchema.safeParse(input);
        if (!parsed.success) {
          throw new ServiceError(
            'invalid_request',
            400,
            parsed.error.issues[0]?.message ?? 'Requête invalide.',
          );
        }
        return createAudit(parsed.data, source);
      }),
    listAudits: (q) => wrap(() => listAudits(q)),
    getAudit: (id) => wrap(() => getAudit(id)),
    getFindings: (id) => wrap(() => getFindings(id)),
    refreshAudit: (id) => wrap(() => refreshAudit(id)),
    analyticsSummary: (days) => wrap(() => analyticsSummary(days)),
    listTemplates: () => wrap(() => listTemplatesApi()),
    getTemplate: (id) => wrap(() => getTemplateApi(id)),
    reportDataSchema: () => wrap(() => Promise.resolve(reportDataSchemaApi())),
    previewTemplate: (id, body) =>
      wrap(() => {
        const parsed = ApiTemplatePreviewBodySchema.safeParse(body);
        if (!parsed.success) throw new ServiceError('invalid_request', 400, 'Requête invalide.');
        return previewTemplateApi(id, parsed.data);
      }),
    saveTemplate: (id, body) =>
      wrap(() => {
        const parsed = ApiTemplateSaveBodySchema.safeParse(body);
        if (!parsed.success) throw new ServiceError('invalid_request', 400, 'Requête invalide.');
        return saveTemplateApi(id, parsed.data);
      }),
    listWebhooks: () => wrap(() => listWebhooks()),
    createWebhook: (body) =>
      wrap(() => {
        const parsed = ApiWebhookCreateBodySchema.safeParse(body);
        if (!parsed.success) {
          throw new ServiceError(
            'invalid_request',
            400,
            parsed.error.issues[0]?.message ?? 'Requête invalide.',
          );
        }
        return createWebhook(parsed.data);
      }),
    testWebhook: (id) => wrap(() => testWebhook(id)),
  };
}
