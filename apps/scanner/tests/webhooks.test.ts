import { createHmac } from 'node:crypto';

import {
  WEBHOOK_API_VERSION,
  WEBHOOK_BACKOFF_MS,
  WEBHOOK_MAX_ATTEMPTS,
  buildLegacyRadarBody,
  buildWebhookPayload,
  isRetryableWebhookFailure,
  webhookBackoffMs,
  webhookUrlProblem,
  type WebhookAuditSnapshot,
  type WebhookSnapshot,
} from '@mynto/shared';
import { describe, expect, it } from 'vitest';

import { isRetryableStatus } from '../src/lib/radar/webhook.js';
import {
  buildLegacyRadarHeaders,
  buildStandardHeaders,
  verifyWebhookSignature,
  webhookSignature,
} from '../src/lib/webhooks/sign.js';
import {
  checkWebhookTarget,
  isBlockedWebhookIp,
  type LookupAll,
} from '../src/lib/webhooks/target.js';

const SECRET = 'whsec_test_secret_value_0123456789';
const NOW = new Date('2026-11-06T10:00:00Z');
const TS = '1793959200';

describe('webhook signature', () => {
  const body = '{"id":"evt_1","type":"ping"}';

  it('t=<ts>,v1=<hex HMAC-SHA256 of "<ts>.<body>">', () => {
    const hex = createHmac('sha256', SECRET).update(`${TS}.${body}`).digest('hex');
    expect(webhookSignature(SECRET, TS, body)).toBe(`t=${TS},v1=${hex}`);
  });

  it('standard headers: event, delivery, signature recomputed from the clock', () => {
    const h = buildStandardHeaders({
      secret: SECRET,
      rawBody: body,
      eventType: 'ping',
      deliveryId: 'd-1',
      now: NOW,
    });
    expect(h).toEqual({
      'Content-Type': 'application/json',
      'User-Agent': 'Mynto-Webhook/1.0',
      'X-Mynto-Event': 'ping',
      'X-Mynto-Delivery': 'd-1',
      'X-Mynto-Signature': webhookSignature(SECRET, TS, body),
    });
  });

  it('receiver check: valid, tampered, wrong secret, outside 5 minutes', () => {
    const header = webhookSignature(SECRET, TS, body);
    expect(verifyWebhookSignature({ secret: SECRET, header, rawBody: body, now: NOW })).toBe(true);
    expect(verifyWebhookSignature({ secret: SECRET, header, rawBody: `${body} `, now: NOW })).toBe(
      false,
    );
    expect(verifyWebhookSignature({ secret: 'other', header, rawBody: body, now: NOW })).toBe(
      false,
    );
    const late = new Date(NOW.getTime() + 301_000);
    expect(verifyWebhookSignature({ secret: SECRET, header, rawBody: body, now: late })).toBe(
      false,
    );
    expect(verifyWebhookSignature({ secret: SECRET, header: 'v1=abc', rawBody: body })).toBe(false);
  });

  it('legacy Radar headers are the historical ones, unchanged', () => {
    const h = buildLegacyRadarHeaders(SECRET, body, NOW);
    expect(Object.keys(h).sort()).toEqual(
      ['Content-Type', 'User-Agent', 'X-Mynto-Signature', 'X-Mynto-Timestamp'].sort(),
    );
    const hex = createHmac('sha256', SECRET).update(`${TS}.${body}`).digest('hex');
    expect(h['X-Mynto-Signature']).toBe(`sha256=${hex}`);
    expect(h['X-Mynto-Timestamp']).toBe(TS);
  });
});

describe('delivery policy', () => {
  it('6 attempts: 1 min, 5 min, 30 min, 2 h, 6 h, then final', () => {
    expect(WEBHOOK_MAX_ATTEMPTS).toBe(6);
    expect([1, 2, 3, 4, 5].map(webhookBackoffMs)).toEqual([...WEBHOOK_BACKOFF_MS]);
    expect(WEBHOOK_BACKOFF_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]);
    expect(webhookBackoffMs(6)).toBeNull();
    expect(webhookBackoffMs(0)).toBeNull();
    // Monotonic.
    for (let i = 1; i < WEBHOOK_BACKOFF_MS.length; i += 1) {
      expect(WEBHOOK_BACKOFF_MS[i] ?? 0).toBeGreaterThan(WEBHOOK_BACKOFF_MS[i - 1] ?? 0);
    }
  });

  it('retries network errors and timeouts, never a blocked target or a redirect', () => {
    const r = (statusCode: number | null, error: string | null, legacy = false) =>
      isRetryableWebhookFailure({ statusCode, error, legacy });
    expect(r(null, 'timeout')).toBe(true);
    expect(r(null, 'network_error')).toBe(true);
    expect(r(null, 'blocked_target:private_target')).toBe(false);
    expect(r(null, 'secret_unavailable')).toBe(false);
    expect(r(301, 'redirect_refused')).toBe(false);
    expect(r(500, 'http_500')).toBe(true);
    expect(r(404, 'http_404')).toBe(true);
    expect(r(410, 'http_410')).toBe(false);
  });

  it('legacy Radar format keeps the former rule: 5xx and 429 only', () => {
    for (const s of [500, 503, 429, 401, 404, 200]) {
      expect(isRetryableWebhookFailure({ statusCode: s, error: 'x', legacy: true })).toBe(
        isRetryableStatus(s),
      );
    }
  });
});

describe('payload builders', () => {
  const audit: WebhookAuditSnapshot = {
    id: 'a1',
    slug: 'abcdefghij12',
    url: 'https://client.fr',
    label: 'Client',
    status: 'completed',
    source: 'dashboard',
    global_score: 7.24,
    ai_score: 58,
    previous_id: null,
  };
  const snapshot: WebhookSnapshot = {
    occurred_at: '2026-11-06T10:00:00.000Z',
    audit,
    link: {
      id: 'l1',
      token: 't'.repeat(32),
      external_ref: null,
      views_count: 1,
      first_opened_at: '2026-11-06T10:00:00.000Z',
    },
  };

  it('standard payload: api_version, score /100, ai_score, links', () => {
    const p = buildWebhookPayload(
      { id: 'evt_1', type: 'link.first_opened', created_at: snapshot.occurred_at, snapshot },
      'https://audit.agence.fr/',
    );
    expect(p).toEqual({
      id: 'evt_1',
      type: 'link.first_opened',
      created_at: '2026-11-06T10:00:00.000Z',
      api_version: WEBHOOK_API_VERSION,
      data: {
        audit: {
          id: 'a1',
          slug: 'abcdefghij12',
          url: 'https://client.fr',
          label: 'Client',
          score: 72,
          ai_score: 58,
          status: 'completed',
          source: 'dashboard',
        },
        link: {
          id: 'l1',
          url: `https://audit.agence.fr/r/${'t'.repeat(32)}`,
          external_ref: null,
          views_count: 1,
          first_opened_at: '2026-11-06T10:00:00.000Z',
        },
        report_url: 'https://audit.agence.fr/audit/full/abcdefghij12',
      },
    });
  });

  it('no score nor ai_score before completion; radar report_url is the tracking link', () => {
    const p = buildWebhookPayload(
      {
        id: 'evt_2',
        type: 'audit.created',
        created_at: snapshot.occurred_at,
        snapshot: {
          ...snapshot,
          audit: { ...audit, status: 'queued', source: 'radar', ai_score: null },
        },
      },
      'https://audit.agence.fr',
    );
    expect(p.data.audit?.score).toBeNull();
    expect(p.data.audit && 'ai_score' in p.data.audit).toBe(false);
    expect(p.data.report_url).toBe(`https://audit.agence.fr/r/${'t'.repeat(32)}`);
  });

  it('email events carry the recipient, other events never do', () => {
    const email = {
      recipient: 'p@client.fr',
      subject: 'Audit',
      status: 'sent' as const,
      error_code: null,
    };
    const withEmail = { ...snapshot, email };
    const sent = buildWebhookPayload(
      { id: 'e', type: 'email.sent', created_at: snapshot.occurred_at, snapshot: withEmail },
      'https://x.fr',
    );
    expect(sent.data.email).toEqual(email);
    const other = buildWebhookPayload(
      { id: 'e', type: 'audit.completed', created_at: snapshot.occurred_at, snapshot: withEmail },
      'https://x.fr',
    );
    expect(JSON.stringify(other)).not.toContain('p@client.fr');
  });

  it('ping payload', () => {
    const p = buildWebhookPayload(
      {
        id: 'evt_p',
        type: 'ping',
        created_at: snapshot.occurred_at,
        snapshot: { occurred_at: snapshot.occurred_at, endpoint_id: 'ep1' },
      },
      'https://x.fr',
    );
    expect(p.data).toEqual({ message: 'Ping de test envoyé depuis mynto.', endpoint_id: 'ep1' });
  });

  it('legacy Radar body: historical keys, order and values', () => {
    expect(buildLegacyRadarBody('link.opened', snapshot)).toBe(
      `{"tracking_token":"${'t'.repeat(32)}","event":"audit_viewed","occurred_at":"2026-11-06T10:00:00.000Z","duration_s":0,"sections_viewed":[]}`,
    );
    expect(buildLegacyRadarBody('link.first_opened', snapshot)).toBeNull();
    expect(buildLegacyRadarBody('audit.completed', snapshot)).toBeNull();
  });
});

describe('SSRF guard of webhook targets', () => {
  const resolvesTo =
    (...ips: string[]): LookupAll =>
    () =>
      Promise.resolve(ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));

  it('syntax: https required, no credentials, no private literal', () => {
    expect(webhookUrlProblem('https://n8n.agence.fr/webhook/x', false)).toBeNull();
    expect(webhookUrlProblem('http://n8n.agence.fr/webhook/x', false)).toBe('https_required');
    expect(webhookUrlProblem('https://u:p@n8n.agence.fr', false)).toBe('credentials_in_url');
    expect(webhookUrlProblem('ftp://x.fr', false)).toBe('invalid_url');
    expect(webhookUrlProblem('pas une url', false)).toBe('invalid_url');
    for (const u of [
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://10.0.0.5/x',
      'https://192.168.1.10:5678/x',
      'https://169.254.169.254/latest',
      'https://100.64.0.1/x',
      'https://[::1]/x',
      'https://[fd00::1]/x',
      'https://n8n/webhook',
      'https://n8n.internal/x',
    ]) {
      expect(webhookUrlProblem(u, false), u).toBe('private_target');
    }
  });

  it('WEBHOOKS_ALLOW_PRIVATE: private targets and plain http accepted', () => {
    expect(webhookUrlProblem('http://n8n:5678/webhook/x', true)).toBeNull();
    expect(webhookUrlProblem('http://192.168.1.10:5678/x', true)).toBeNull();
    expect(webhookUrlProblem('https://u:p@n8n:5678/x', true)).toBe('credentials_in_url');
  });

  it('reserved ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.0.1',
      '169.254.169.254',
      '100.100.1.1',
      '198.18.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '::1',
      'fe80::1',
      'fd12::1',
      '::ffff:10.0.0.1',
      '64:ff9b::a00:1',
    ]) {
      expect(isBlockedWebhookIp(ip), ip).toBe(true);
    }
    for (const ip of ['93.184.216.34', '1.1.1.1', '2606:4700:4700::1111']) {
      expect(isBlockedWebhookIp(ip), ip).toBe(false);
    }
  });

  it('a public name resolving to a private address is refused (every answer is checked)', async () => {
    const res = await checkWebhookTarget('https://hooks.example.com/x', {
      allowPrivate: false,
      lookup: resolvesTo('93.184.216.34', '10.0.0.7'),
    });
    expect(res).toEqual({ ok: false, reason: 'private_target' });
  });

  it('returns the address to pin', async () => {
    const res = await checkWebhookTarget('https://hooks.example.com/x', {
      allowPrivate: false,
      lookup: resolvesTo('93.184.216.34'),
    });
    expect(res.ok && res.ip).toBe('93.184.216.34');
  });

  it('allow-private resolves and pins a private address', async () => {
    const res = await checkWebhookTarget('http://n8n:5678/webhook/x', {
      allowPrivate: true,
      lookup: resolvesTo('172.18.0.4'),
    });
    expect(res.ok && res.ip).toBe('172.18.0.4');
  });

  it('DNS failure is reported, not thrown', async () => {
    const res = await checkWebhookTarget('https://nowhere.example.com/x', {
      allowPrivate: false,
      lookup: () => Promise.reject(new Error('ENOTFOUND')),
    });
    expect(res).toEqual({ ok: false, reason: 'dns_error' });
  });
});
