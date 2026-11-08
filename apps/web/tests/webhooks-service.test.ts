import type { WebhookEndpointRow } from '@mynto/db';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: vi.fn(), cookies: vi.fn() }));

const { toApiWebhook, toApiDelivery } = await import('../lib/services/webhooks');
const { openApiDocument, listOperations } = await import('../lib/api/openapi');

const ROW: WebhookEndpointRow = {
  id: '6f1c2c7e-6f0a-4b8e-9d0a-0d2b5b0c1a11',
  url: 'https://radar.example.com/webhooks/mynto',
  description: 'Radar (RADAR_WEBHOOK_URL)',
  events: ['link.opened'],
  active: true,
  secret_hint: null,
  legacy_radar_format: true,
  system_key: 'radar',
  consecutive_failures: 0,
  disabled_at: null,
  disabled_reason: null,
  last_status: 'success',
  last_status_code: 200,
  last_delivery_at: '2026-11-06T10:00:00.000Z',
  created_at: '2026-11-01T10:00:00.000Z',
  updated_at: '2026-11-01T10:00:00.000Z',
};

describe('webhooks service mapping', () => {
  it('never exposes the secret; env-managed flag from system_key', () => {
    const w = toApiWebhook(ROW);
    expect(w.managed_by_env).toBe(true);
    expect(w).not.toHaveProperty('secret');
    expect(w).not.toHaveProperty('secret_ciphertext');
    expect(w).not.toHaveProperty('system_key');
    expect(toApiWebhook({ ...ROW, system_key: null }).managed_by_env).toBe(false);
  });

  it('delivery: next attempt only while pending, body only in the detail', () => {
    const base = {
      id: 'd',
      endpoint_id: ROW.id,
      event_id: 'evt_000000000000000000000001',
      event_type: 'ping' as const,
      format: 'standard' as const,
      status: 'success' as const,
      attempts: 1,
      next_attempt_at: '2026-11-06T10:00:00.000Z',
      last_status_code: 200,
      last_duration_ms: 12,
      last_error: null,
      manual: false,
      created_at: '2026-11-06T10:00:00.000Z',
      completed_at: '2026-11-06T10:00:00.000Z',
    };
    const list = toApiDelivery(base);
    expect(list.next_attempt_at).toBeNull();
    expect(list).not.toHaveProperty('request_body');
    const detail = toApiDelivery({ ...base, status: 'pending', request_body: '{}', attempts_log: [] });
    expect(detail.next_attempt_at).toBe(base.next_attempt_at);
    expect(detail.request_body).toBe('{}');
  });

  it('OpenAPI documents the webhook routes', () => {
    const ops = listOperations(openApiDocument('https://audit.test'));
    const paths = ops.map((o) => `${o.method} ${o.path}`);
    for (const p of [
      'GET /webhooks',
      'POST /webhooks',
      'GET /webhooks/{id}',
      'PATCH /webhooks/{id}',
      'DELETE /webhooks/{id}',
      'POST /webhooks/{id}/test',
      'POST /webhooks/{id}/rotate-secret',
      'GET /webhooks/{id}/deliveries',
      'GET /webhooks/{id}/deliveries/{deliveryId}',
      'POST /webhooks/{id}/deliveries/{deliveryId}/resend',
    ]) {
      expect(paths).toContain(p);
    }
  });
});
