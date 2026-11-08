import type {
  ApiAnalyticsSummary,
  ApiAudit,
  ApiAuditList,
  ApiCreateAuditBody,
  ApiFinding,
  ApiListAuditsQuery,
  ApiTemplate,
  ApiTemplatePreview,
  ApiTemplatePreviewBody,
  ApiTemplateSaveBody,
  ApiTemplateSaveResult,
  ApiTemplateSummary,
  ApiWebhook,
  ApiWebhookCreateBody,
  ApiWebhookTestResult,
  ApiWebhookWithSecret,
} from '@mynto/shared';

import { MyntoToolError, type MyntoBackend } from './tools.js';

/**
 * Backend of the stdio server: the REST API v1 of a mynto install
 * (MYNTO_URL + MYNTO_API_KEY). The key is only ever sent in the
 * Authorization header to that URL; it is never printed.
 */
export interface HttpBackendOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createHttpBackend(opts: HttpBackendOptions): MyntoBackend {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const doFetch = opts.fetch ?? fetch;

  async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown, okStatuses: number[] = []): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, opts.timeoutMs ?? 30_000);
    let res: Response;
    try {
      res = await doFetch(`${base}/api/v1${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });
    } catch {
      throw new MyntoToolError('unreachable', `Cannot reach ${base}. Check MYNTO_URL.`);
    } finally {
      clearTimeout(timer);
    }
    const data = await res.json().catch(() => null);
    if (!res.ok && !okStatuses.includes(res.status)) {
      const e = (data ?? {}) as { error?: unknown; message?: unknown };
      throw new MyntoToolError(
        typeof e.error === 'string' ? e.error : `http_${String(res.status)}`,
        typeof e.message === 'string' ? e.message : `HTTP ${String(res.status)}`,
      );
    }
    return data as T;
  }

  return {
    createAudit: (input: ApiCreateAuditBody) => call<ApiAudit>('POST', '/audits', input),
    listAudits: (q: ApiListAuditsQuery) => {
      const params = new URLSearchParams({ limit: String(q.limit), offset: String(q.offset) });
      if (q.status) params.set('status', q.status);
      if (q.q) params.set('q', q.q);
      return call<ApiAuditList>('GET', `/audits?${params.toString()}`);
    },
    getAudit: (id: string) => call<ApiAudit>('GET', `/audits/${encodeURIComponent(id)}`),
    getFindings: async (id: string) =>
      (await call<{ data: ApiFinding[] }>('GET', `/audits/${encodeURIComponent(id)}/findings`))
        .data,
    refreshAudit: (id: string) =>
      call<{ audit: ApiAudit; refreshed: boolean; reason?: string }>(
        'POST',
        `/audits/${encodeURIComponent(id)}/refresh`,
      ),
    analyticsSummary: (days: number) =>
      call<ApiAnalyticsSummary>('GET', `/analytics/summary?days=${String(days)}`),
    listTemplates: async () => (await call<{ data: ApiTemplateSummary[] }>('GET', '/templates')).data,
    getTemplate: (id: string) => call<ApiTemplate>('GET', `/templates/${encodeURIComponent(id)}`),
    reportDataSchema: () =>
      call<{ schema: Record<string, unknown>; example: unknown }>('GET', '/report-data/schema'),
    previewTemplate: (id: string, body: ApiTemplatePreviewBody) =>
      call<ApiTemplatePreview>('POST', `/templates/${encodeURIComponent(id)}/preview`, body),
    // 422 = the template did not pass the check: the issues are the answer.
    saveTemplate: (id: string, body: ApiTemplateSaveBody) =>
      call<ApiTemplateSaveResult>('PUT', `/templates/${encodeURIComponent(id)}`, body, [422]),
    listWebhooks: async () => (await call<{ data: ApiWebhook[] }>('GET', '/webhooks')).data,
    createWebhook: (body: ApiWebhookCreateBody) =>
      call<ApiWebhookWithSecret>('POST', '/webhooks', body),
    testWebhook: (id: string) =>
      call<ApiWebhookTestResult>('POST', `/webhooks/${encodeURIComponent(id)}/test`),
  };
}
