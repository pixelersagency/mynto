import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { ApiAudit } from '@mynto/shared';
import { DEFAULT_AUDIT_MODULES } from '@mynto/shared';
/* eslint-disable @typescript-eslint/unbound-method -- vi.fn mocks */
import { describe, expect, it, vi } from 'vitest';

import { createHttpBackend } from '../src/http-backend.js';
import { createMyntoServer } from '../src/server.js';
import { MyntoToolError, TOOL_NAMES, type MyntoBackend } from '../src/tools.js';

const AUDIT: ApiAudit = {
  id: '11111111-1111-4111-8111-111111111111',
  url: 'https://acme.fr/',
  label: 'Acme',
  status: 'completed',
  source: 'mcp',
  score: 72,
  band: 'fair',
  axes: [],
  modules: DEFAULT_AUDIT_MODULES,
  ai_readiness: {
    evaluated: true,
    score: 55,
    level: 2,
    level_name: 'Bot-aware',
    site_type: 'vitrine',
    site_type_auto: true,
    included_in_global_score: false,
  },
  created_at: '2026-11-01T10:00:00.000Z',
  scanned_at: '2026-11-01T10:00:05.000Z',
  expires_at: '2026-12-31T10:00:00.000Z',
  report_url: 'https://audit.test/audit/full/abc',
  tracking_url: 'https://audit.test/r/tok',
  template: null,
  views_count: 2,
  last_viewed_at: '2026-11-02T10:00:00.000Z',
  pages: 3,
};

function fakeBackend(): MyntoBackend {
  return {
    createAudit: vi.fn(() => Promise.resolve({ ...AUDIT, status: 'queued' as const })),
    listAudits: vi.fn((q: { limit: number; offset: number }) =>
      Promise.resolve({
        data: [AUDIT],
        pagination: { limit: q.limit, offset: q.offset, total: 1 },
      }),
    ),
    getAudit: vi.fn((id: string) =>
      id === AUDIT.id
        ? Promise.resolve(AUDIT)
        : Promise.reject(new MyntoToolError('not_found', 'Audit introuvable.')),
    ),
    getFindings: vi.fn(() => Promise.resolve([])),
    refreshAudit: vi.fn(() => Promise.resolve({ audit: AUDIT, refreshed: true })),
    analyticsSummary: vi.fn(() => Promise.reject(new Error('boom secret detail'))),
    listTemplates: vi.fn(() =>
      Promise.resolve([
        {
          id: 'minimal',
          name: 'Minimaliste',
          description: '',
          version: '1.0.0',
          builtin: true,
          enabled: true,
          is_default: true,
          based_on: null,
        },
      ]),
    ),
    getTemplate: vi.fn(() =>
      Promise.reject(new MyntoToolError('not_found', 'Modèle introuvable.')),
    ),
    reportDataSchema: vi.fn(() => Promise.resolve({ schema: { title: 'x' }, example: {} })),
    previewTemplate: vi.fn(() => Promise.resolve({ html: '<!doctype html>', issues: [] })),
    saveTemplate: vi.fn(() =>
      Promise.resolve({
        saved: false,
        created: false,
        issues: [
          { level: 'error' as const, file: 'report.liquid', message: 'balise <script> interdite' },
        ],
      }),
    ),
    listWebhooks: vi.fn(() => Promise.resolve([WEBHOOK])),
    createWebhook: vi.fn(() => Promise.resolve({ ...WEBHOOK, secret: 'whsec_once' })),
    testWebhook: vi.fn(() =>
      Promise.resolve({ event_id: 'evt_000000000000000000000001', status: 'queued' as const }),
    ),
  };
}

const WEBHOOK = {
  id: '6f1c2c7e-6f0a-4b8e-9d0a-0d2b5b0c1a11',
  url: 'https://n8n.agence.fr/webhook/mynto',
  description: null,
  events: ['link.first_opened' as const],
  active: true,
  legacy_radar_format: false,
  managed_by_env: false,
  secret_hint: 'whs…abcd',
  consecutive_failures: 0,
  disabled_at: null,
  disabled_reason: null,
  last_status: null,
  last_status_code: null,
  last_delivery_at: null,
  created_at: '2026-11-06T10:00:00.000Z',
};

async function connect(backend: MyntoBackend): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await createMyntoServer(backend).connect(serverT);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientT);
  return client;
}

describe('mynto MCP tools', () => {
  it('exposes the tools with descriptions and input schemas', async () => {
    const client = await connect(fakeBackend());
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    for (const t of tools) {
      expect(t.description?.length ?? 0).toBeGreaterThan(40);
      expect(t.inputSchema.type).toBe('object');
    }
  });

  it('list_audits defaults the pagination and returns structured content', async () => {
    const backend = fakeBackend();
    const client = await connect(backend);
    const res = await client.callTool({ name: 'list_audits', arguments: { status: 'completed' } });
    expect(backend.listAudits).toHaveBeenCalledWith({ limit: 25, offset: 0, status: 'completed' });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ pagination: { total: 1 } });
  });

  it('rejects invalid input before reaching the backend', async () => {
    const backend = fakeBackend();
    const client = await connect(backend);
    const res = await client.callTool({ name: 'get_audit', arguments: { id: 'not-a-uuid' } });
    expect(res.isError).toBe(true);
    expect(backend.getAudit).not.toHaveBeenCalled();
  });

  it('get_report_link returns only the links and opening state', async () => {
    const client = await connect(fakeBackend());
    const res = await client.callTool({ name: 'get_report_link', arguments: { id: AUDIT.id } });
    expect(res.structuredContent).toEqual({
      id: AUDIT.id,
      status: 'completed',
      tracking_url: AUDIT.tracking_url,
      report_url: AUDIT.report_url,
      opened: true,
      last_viewed_at: AUDIT.last_viewed_at,
    });
  });

  it('maps backend errors to tool errors without leaking internals', async () => {
    const client = await connect(fakeBackend());
    const nf = await client.callTool({
      name: 'get_audit',
      arguments: { id: '22222222-2222-4222-8222-222222222222' },
    });
    expect(nf.isError).toBe(true);
    expect(JSON.stringify(nf.content)).toContain('not_found');
    const boom = await client.callTool({ name: 'get_analytics_summary', arguments: {} });
    expect(boom.isError).toBe(true);
    expect(JSON.stringify(boom.content)).not.toContain('secret detail');
  });
});

describe('AI readiness through MCP', () => {
  it('create_audit forwards site_type and the ai_readiness module', async () => {
    const backend = fakeBackend();
    const client = await connect(backend);
    const res = await client.callTool({
      name: 'create_audit',
      arguments: {
        url: 'https://shop.fr',
        site_type: 'ecommerce',
        modules: { ai_readiness: true },
      },
    });
    expect(res.isError).toBeFalsy();
    expect(backend.createAudit).toHaveBeenCalledWith({
      url: 'https://shop.fr',
      site_type: 'ecommerce',
      modules: { ai_readiness: true },
    });
  });

  it('rejects an unknown site type before the backend', async () => {
    const backend = fakeBackend();
    const client = await connect(backend);
    const res = await client.callTool({
      name: 'create_audit',
      arguments: { url: 'https://shop.fr', site_type: 'boutique' },
    });
    expect(res.isError).toBe(true);
    expect(backend.createAudit).not.toHaveBeenCalled();
  });

  it('get_audit returns the AI readiness block', async () => {
    const client = await connect(fakeBackend());
    const res = await client.callTool({ name: 'get_audit', arguments: { id: AUDIT.id } });
    expect(res.structuredContent).toMatchObject({ ai_readiness: { score: 55, evaluated: true } });
  });

  it('documents the module in the tool schemas', async () => {
    const client = await connect(fakeBackend());
    const { tools } = await client.listTools();
    const create = tools.find((t) => t.name === 'create_audit');
    expect(JSON.stringify(create?.inputSchema)).toContain('site_type');
    expect(JSON.stringify(create?.inputSchema)).toContain('ai_readiness');
    expect(tools.find((t) => t.name === 'get_findings')?.description).toContain('ia.');
  });
});

describe('HTTP backend (stdio server)', () => {
  it('sends the Bearer key to the REST API and maps errors', async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      void init;
      if (url.endsWith('/api/v1/audits?limit=25&offset=0')) {
        return Promise.resolve(
          Response.json({ data: [], pagination: { limit: 25, offset: 0, total: 0 } }),
        );
      }
      return Promise.resolve(
        Response.json({ error: 'not_found', message: 'Audit introuvable.' }, { status: 404 }),
      );
    });
    const backend = createHttpBackend({
      baseUrl: 'https://audit.test/',
      apiKey: 'myn_live_test',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(backend.listAudits({ limit: 25, offset: 0 })).resolves.toMatchObject({ data: [] });
    const init = fetchMock.mock.calls[0]?.[1];
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer myn_live_test');
    await expect(backend.getAudit(AUDIT.id)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('template tools: list, schema, preview and a refused save', async () => {
    const backend = fakeBackend();
    const client = await connect(backend);
    const list = await client.callTool({ name: 'list_templates', arguments: {} });
    expect(JSON.stringify(list.structuredContent)).toContain('minimal');
    const schema = await client.callTool({ name: 'get_report_data_schema', arguments: {} });
    expect(schema.isError).toBeFalsy();
    await client.callTool({
      name: 'preview_template',
      arguments: { id: 'maison', mode: 'print', files: { 'report.liquid': '<h1>x</h1>' } },
    });
    expect(backend.previewTemplate).toHaveBeenCalledWith('maison', {
      mode: 'print',
      files: { 'report.liquid': '<h1>x</h1>' },
    });
    const saved = await client.callTool({
      name: 'save_template',
      arguments: { id: 'maison', files: { 'report.liquid': '<script>' } },
    });
    expect(JSON.stringify(saved.structuredContent)).toContain('"saved":false');
    const bad = await client.callTool({ name: 'get_template', arguments: { id: 'Bad Id' } });
    expect(bad.isError).toBe(true);
  });

  it('webhook tools: list, create (secret once) and test', async () => {
    const backend = fakeBackend();
    const client = await connect(backend);
    const list = await client.callTool({ name: 'list_webhooks', arguments: {} });
    expect(list.structuredContent).toEqual({ webhooks: [WEBHOOK] });
    expect(JSON.stringify(list)).not.toContain('whsec_once');

    const created = await client.callTool({
      name: 'create_webhook',
      arguments: { url: WEBHOOK.url, events: ['link.first_opened', 'audit.completed'] },
    });
    expect(backend.createWebhook).toHaveBeenCalledWith({
      url: WEBHOOK.url,
      events: ['link.first_opened', 'audit.completed'],
    });
    expect(created.structuredContent).toMatchObject({ secret: 'whsec_once' });

    const bad = await client.callTool({
      name: 'create_webhook',
      arguments: { url: WEBHOOK.url, events: ['audit.exploded'] },
    });
    expect(bad.isError).toBe(true);

    const ping = await client.callTool({ name: 'test_webhook', arguments: { id: WEBHOOK.id } });
    expect(backend.testWebhook).toHaveBeenCalledWith(WEBHOOK.id);
    expect(ping.structuredContent).toMatchObject({ status: 'queued' });
  });
});
