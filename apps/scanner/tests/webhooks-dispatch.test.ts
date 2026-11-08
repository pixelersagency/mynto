import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import {
  createRepos,
  createSql,
  decryptSecret,
  encryptSecret,
  generateWebhookSecret,
  maskSecret,
  webhookSecretAad,
  type Repos,
  type Sql,
} from '@mynto/db';
import { runMigrations } from '@mynto/db/migrate';
import { WEBHOOK_AUTO_DISABLE_AFTER, type WebhookPayload } from '@mynto/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, inject, it } from 'vitest';

import { signWebhook } from '../src/lib/radar/webhook.js';
import { deliverOnce, dispatchTick, type DeliverDeps } from '../src/lib/webhooks/deliver.js';
import { verifyWebhookSignature } from '../src/lib/webhooks/sign.js';

/**
 * Integration: outbox (real Postgres, real repos) -> dispatcher -> local
 * HTTP receiver that checks the signature, with retries, auto-disable, SSRF
 * default, redirects, timeouts and the legacy Radar format. BullMQ is
 * replaced by a plain array: the queue only carries (delivery, attempt).
 */

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string | null;
    databaseSource: string;
  }
}

const databaseUrl = inject('databaseUrl');
const MASTER = randomBytes(32).toString('base64');
const RADAR_SECRET = 'radar-secret-0123456789-abcdefgh'; // gitleaks:allow (test fixture)
const BASE = 'https://audit.agence.fr';

interface Received {
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

type Responder = (r: Received) => {
  status: number;
  body?: string;
  headers?: Record<string, string>;
  delayMs?: number;
};

describe.skipIf(databaseUrl === null)('webhook dispatcher (integration)', () => {
  let admin: Sql;
  let sql: Sql;
  let repos: Repos;
  const dbName = `mynto_wh_${randomBytes(4).toString('hex')}`;
  let server: Server;
  let origin = '';
  const received: Received[] = [];
  let respond: Responder = () => ({ status: 200, body: 'ok' });

  beforeAll(async () => {
    admin = createSql(databaseUrl ?? '', { max: 1 });
    await admin.unsafe(`create database ${dbName}`);
    const url = new URL(databaseUrl ?? '');
    url.pathname = `/${dbName}`;
    sql = createSql(url.toString(), { max: 5 });
    await runMigrations(sql);
    repos = createRepos(sql);

    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const r: Received = {
          path: req.url ?? '',
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        };
        received.push(r);
        const out = respond(r);
        setTimeout(() => {
          res.writeHead(out.status, { 'content-type': 'text/plain', ...(out.headers ?? {}) });
          res.end(out.body ?? '');
        }, out.delayMs ?? 0);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
    await sql.end({ timeout: 5 });
    await admin.unsafe(`drop database if exists ${dbName} with (force)`);
    await admin.end({ timeout: 5 });
  });

  beforeEach(async () => {
    received.length = 0;
    respond = () => ({ status: 200, body: 'ok' });
    await sql`truncate audits_full, radar_audits, radar_audit_views, webhook_endpoints,
                       webhook_events, webhook_deliveries, webhook_delivery_attempts cascade`;
  });

  function deps(extra: Partial<DeliverDeps> = {}): DeliverDeps {
    return {
      repo: repos.webhooks,
      decryptSecret: (id, c) => decryptSecret(c, MASTER, webhookSecretAad(id)),
      radarSecret: RADAR_SECRET,
      // The receiver listens on 127.0.0.1: allowed here, refused by default.
      allowPrivate: true,
      timeoutMs: 2_000,
      ...extra,
    };
  }

  async function endpoint(
    events: string[],
    opts: { path?: string; active?: boolean } = {},
  ): Promise<{ id: string; secret: string }> {
    const id = randomUUID();
    const secret = generateWebhookSecret();
    await repos.webhooks.create({
      id,
      url: `${origin}${opts.path ?? '/hook'}`,
      events: events as never,
      active: opts.active ?? true,
      secretCiphertext: encryptSecret(secret, MASTER, webhookSecretAad(id)),
      secretHint: maskSecret(secret),
    });
    return { id, secret };
  }

  let tokenSeq = 0;
  async function launchAudit(): Promise<{ auditId: string; linkId: string }> {
    tokenSeq += 1;
    return repos.dashboard.createAuditWithLink(
      {
        slug: `wh${String(Date.now()).slice(-8)}${String(tokenSeq).padStart(3, '0')}`,
        url: 'https://client.example.com',
      },
      {
        domain: 'client.example.com',
        trackingToken: `${'k'.repeat(30)}${String(tokenSeq).padStart(2, '0')}`,
      },
    );
  }

  /** One dispatcher tick, then every queued attempt is delivered (BullMQ stand-in). */
  async function pump(d: DeliverDeps = deps()) {
    const queue: { id: string; attempt: number }[] = [];
    await dispatchTick({
      repo: repos.webhooks,
      baseUrl: BASE,
      enqueue: (id, attempt) => {
        queue.push({ id, attempt });
        return Promise.resolve();
      },
    });
    const results = [];
    for (const job of queue) results.push(await deliverOnce(job.id, job.attempt, d));
    return results;
  }

  /** Makes every pending retry due now (instead of waiting 1 min ... 6 h). */
  async function fastForward(): Promise<void> {
    await sql`update webhook_deliveries set next_attempt_at = now() where status = 'pending'`;
  }

  it('outbox -> dispatcher -> receiver: signed, verifiable, stable event id', async () => {
    const ep = await endpoint(['audit.created']);
    const { auditId } = await launchAudit();
    const [res] = await pump();
    expect(res?.kind).toBe('success');
    expect(received).toHaveLength(1);
    const r = received[0];
    if (!r) throw new Error('nothing received');
    expect(r.headers['x-mynto-event']).toBe('audit.created');
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.headers['user-agent']).toBe('Mynto-Webhook/1.0');
    const sig = String(r.headers['x-mynto-signature']);
    expect(sig).toMatch(/^t=\d+,v1=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature({ secret: ep.secret, header: sig, rawBody: r.body })).toBe(true);
    // Recomputed by hand, like a receiver would.
    const t = /t=(\d+)/.exec(sig)?.[1] ?? '';
    const hex = createHmac('sha256', ep.secret).update(`${t}.${r.body}`).digest('hex');
    expect(sig).toBe(`t=${t},v1=${hex}`);
    const body = JSON.parse(r.body) as WebhookPayload;
    expect(body.type).toBe('audit.created');
    expect(body.data.audit?.id).toBe(auditId);
    const [ev] = await sql<{ id: string }[]>`select id from webhook_events`;
    expect(body.id).toBe(ev?.id);
    expect(r.headers['x-mynto-delivery']).toMatch(/^[0-9a-f-]{36}$/);
    // Already delivered: a second pump sends nothing.
    await pump();
    expect(received).toHaveLength(1);
  });

  it('retries with the same body and event id, then succeeds', async () => {
    const ep = await endpoint(['audit.created']);
    await launchAudit();
    let n = 0;
    respond = () => {
      n += 1;
      return n <= 2 ? { status: 503, body: 'busy' } : { status: 200, body: 'ok' };
    };
    const first = await pump();
    expect(first[0]).toMatchObject({ kind: 'retry', nextAttempt: 2, delayMs: 60_000 });
    // Not due yet: nothing is sent.
    expect(await pump()).toEqual([]);
    await fastForward();
    expect((await pump())[0]).toMatchObject({ kind: 'retry', nextAttempt: 3, delayMs: 300_000 });
    await fastForward();
    expect((await pump())[0]).toMatchObject({ kind: 'success' });

    expect(received).toHaveLength(3);
    const bodies = new Set(received.map((r) => r.body));
    expect(bodies.size).toBe(1);
    const deliveries = new Set(received.map((r) => r.headers['x-mynto-delivery']));
    expect(deliveries.size).toBe(1);
    for (const r of received) {
      expect(
        verifyWebhookSignature({
          secret: ep.secret,
          header: String(r.headers['x-mynto-signature']),
          rawBody: r.body,
        }),
      ).toBe(true);
    }
    const [row] = await sql<{ id: string }[]>`select id from webhook_deliveries`;
    const detail = await repos.webhooks.getDelivery(row?.id ?? '');
    expect(detail?.status).toBe('success');
    expect(detail?.attempts_log.map((a) => [a.attempt, a.status_code, a.response_body])).toEqual([
      [1, 503, 'busy'],
      [2, 503, 'busy'],
      [3, 200, 'ok'],
    ]);
  });

  it('6 attempts then final failure; the streak counts final failures only', async () => {
    const ep = await endpoint(['audit.created']);
    await launchAudit();
    respond = () => ({ status: 500, body: 'x'.repeat(5000) });
    const kinds: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      for (const r of await pump()) kinds.push(r.kind);
      await fastForward();
    }
    expect(kinds).toEqual(['retry', 'retry', 'retry', 'retry', 'retry', 'failed']);
    expect(received).toHaveLength(6);
    const [row] = await sql<{ id: string }[]>`select id from webhook_deliveries`;
    const detail = await repos.webhooks.getDelivery(row?.id ?? '');
    expect(detail).toMatchObject({ status: 'failed', attempts: 6, last_status_code: 500 });
    // Response truncated to 2 KB in the log.
    expect(detail?.attempts_log[0]?.response_body).toHaveLength(2048);
    expect((await repos.webhooks.get(ep.id))?.consecutive_failures).toBe(1);
  });

  it(`auto-disables after ${String(WEBHOOK_AUTO_DISABLE_AFTER)} final failures in a row`, async () => {
    const ep = await endpoint(['audit.created']);
    await sql`update webhook_endpoints set consecutive_failures = ${WEBHOOK_AUTO_DISABLE_AFTER - 1} where id = ${ep.id}`;
    await launchAudit();
    respond = () => ({ status: 410, body: 'gone' });
    const [res] = await pump();
    expect(res).toMatchObject({ kind: 'failed', endpointDisabled: true });
    expect(await repos.webhooks.get(ep.id)).toMatchObject({
      active: false,
      disabled_reason: 'auto',
      consecutive_failures: WEBHOOK_AUTO_DISABLE_AFTER,
    });
    expect((await repos.webhooks.listAutoDisabled()).map((e) => e.id)).toEqual([ep.id]);
    // Off: new events no longer reach it.
    await launchAudit();
    expect(await pump()).toEqual([]);
    expect(received).toHaveLength(1);
  });

  it('a delivery whose endpoint was switched off in the meantime is cancelled', async () => {
    const ep = await endpoint(['audit.created']);
    await launchAudit();
    respond = () => ({ status: 500 });
    await pump();
    await repos.webhooks.update(ep.id, { active: false });
    await fastForward();
    const [res] = await pump();
    expect(res).toEqual({ kind: 'cancelled', reason: 'endpoint_disabled' });
    expect(received).toHaveLength(1);
  });

  it('legacy Radar endpoint: historical body and headers, byte for byte, 4xx final', async () => {
    await repos.webhooks.syncRadarEndpoint(`${origin}/webhooks/mynto`);
    const link = await repos.radar.createScanWithLink(
      {
        slug: `rad${String(Date.now()).slice(-9)}`,
        url: 'https://prospect.example.com/',
        source: 'radar',
      },
      {
        externalRef: 'ref-1',
        domain: 'prospect.example.com',
        trackingToken: 'r'.repeat(32),
        reused: false,
      },
    );
    const viewedAt = new Date().toISOString();
    await repos.radar.recordView({
      radarAuditId: link.id,
      ipHash: 'h',
      userAgent: 'Chrome, mobile',
      viewedAt,
      dedupeWindowMs: 1,
    });
    const [res] = await pump();
    expect(res?.kind).toBe('success');
    const r = received[0];
    if (!r) throw new Error('nothing received');
    expect(r.path).toBe('/webhooks/mynto');
    // Exactly what the former radar-webhook queue sent.
    expect(r.body).toBe(
      JSON.stringify({
        tracking_token: 'r'.repeat(32),
        event: 'audit_viewed',
        occurred_at: viewedAt,
        duration_s: 0,
        sections_viewed: [],
      }),
    );
    const ts = String(r.headers['x-mynto-timestamp']);
    expect(ts).toMatch(/^\d+$/);
    // Radar's own check: "sha256=" + HMAC(secret, ts + "." + body).
    expect(r.headers['x-mynto-signature']).toBe(signWebhook(RADAR_SECRET, ts, r.body));
    expect(r.headers['user-agent']).toBe('Mynto-Webhook/1.0');
    expect(r.headers['content-type']).toBe('application/json');
    expect(r.headers['x-mynto-event']).toBeUndefined();
    expect(r.headers['x-mynto-delivery']).toBeUndefined();

    // Radar answers 404 on an unknown token: final, as before.
    respond = () => ({ status: 404 });
    await repos.radar.recordView({
      radarAuditId: link.id,
      ipHash: 'other',
      userAgent: null,
      viewedAt: new Date().toISOString(),
      dedupeWindowMs: 1,
    });
    expect((await pump())[0]).toMatchObject({ kind: 'failed' });
  });

  it('the env-managed Radar endpoint is trusted even without WEBHOOKS_ALLOW_PRIVATE', async () => {
    await repos.webhooks.syncRadarEndpoint(`${origin}/webhooks/mynto`);
    const { linkId } = await launchAudit();
    await repos.radar.recordView({
      radarAuditId: linkId,
      ipHash: 'h',
      userAgent: null,
      viewedAt: new Date().toISOString(),
      dedupeWindowMs: 1,
    });
    const [res] = await pump(deps({ allowPrivate: false }));
    expect(res?.kind).toBe('success');
    expect(received).toHaveLength(1);
  });

  it('legacy flag unchecked: Radar endpoint gets the standard format, signed with RADAR_WEBHOOK_SECRET', async () => {
    const ep = await repos.webhooks.syncRadarEndpoint(`${origin}/webhooks/mynto`);
    await repos.webhooks.update(ep?.id ?? '', { legacy_radar_format: false });
    const { linkId } = await launchAudit();
    await repos.radar.recordView({
      radarAuditId: linkId,
      ipHash: 'h',
      userAgent: null,
      viewedAt: new Date().toISOString(),
      dedupeWindowMs: 1,
    });
    await pump();
    const r = received[0];
    expect((JSON.parse(r?.body ?? '{}') as WebhookPayload).type).toBe('link.opened');
    expect(
      verifyWebhookSignature({
        secret: RADAR_SECRET,
        header: String(r?.headers['x-mynto-signature']),
        rawBody: r?.body ?? '',
      }),
    ).toBe(true);
  });

  it('SSRF default: a private target is refused before any request, final', async () => {
    await endpoint(['audit.created']);
    await launchAudit();
    const [res] = await pump(deps({ allowPrivate: false }));
    expect(res).toMatchObject({ kind: 'failed', error: 'blocked_target:https_required' });
    expect(received).toHaveLength(0);
  });

  it('SSRF default on an https literal private address', async () => {
    const id = randomUUID();
    await repos.webhooks.create({
      id,
      url: 'https://127.0.0.1:9/hook',
      events: ['audit.created'],
      secretCiphertext: encryptSecret('s', MASTER, webhookSecretAad(id)),
      secretHint: '…s',
    });
    await launchAudit();
    const [res] = await pump(deps({ allowPrivate: false }));
    expect(res).toMatchObject({ kind: 'failed', error: 'blocked_target:private_target' });
  });

  it('redirects are refused, never followed', async () => {
    await endpoint(['audit.created']);
    await launchAudit();
    respond = (r) =>
      r.path === '/hook'
        ? { status: 302, headers: { location: `${origin}/elsewhere` } }
        : { status: 200 };
    const [res] = await pump();
    expect(res).toMatchObject({ kind: 'failed', statusCode: 302, error: 'redirect_refused' });
    expect(received.map((r) => r.path)).toEqual(['/hook']);
  });

  it('timeout is retried', async () => {
    await endpoint(['audit.created']);
    await launchAudit();
    respond = () => ({ status: 200, delayMs: 600 });
    const [res] = await pump(deps({ timeoutMs: 200 }));
    expect(res).toMatchObject({ kind: 'retry', error: 'timeout' });
  });

  it('ping reaches an endpoint that is off; a wrong master key fails cleanly', async () => {
    const ep = await endpoint(['audit.created'], { active: false });
    await repos.webhooks.ping(ep.id);
    expect((await pump())[0]?.kind).toBe('success');
    expect((JSON.parse(received[0]?.body ?? '{}') as WebhookPayload).type).toBe('ping');

    await repos.webhooks.ping(ep.id);
    const [res] = await pump(
      deps({
        decryptSecret: () => {
          throw new Error('bad key');
        },
      }),
    );
    expect(res).toMatchObject({ kind: 'failed', error: 'secret_unavailable' });
    expect(received).toHaveLength(1);
  });

  it('crash recovery: a lost job and an expired claim are swept up', async () => {
    await endpoint(['audit.created']);
    await launchAudit();
    // Fan-out happened but the job never ran (crash before enqueue).
    await repos.webhooks.fanOut(BASE);
    // Claimed then the worker died mid-request: the lock expires.
    const [d] = await sql<{ id: string }[]>`select id from webhook_deliveries`;
    expect(await repos.webhooks.claim(d?.id ?? '', 1)).not.toBeNull();
    await sql`update webhook_deliveries set locked_until = now() - interval '1 second'`;
    const [res] = await pump();
    expect(res?.kind).toBe('success');
    expect(received).toHaveLength(1);
  });

  it('"Renvoyer" sends the same event again under a new delivery id', async () => {
    const ep = await endpoint(['audit.created']);
    await launchAudit();
    await pump();
    const [d] = await sql<{ id: string }[]>`select id from webhook_deliveries`;
    await repos.webhooks.resend(d?.id ?? '');
    await pump();
    expect(received).toHaveLength(2);
    expect(received[0]?.body).toBe(received[1]?.body);
    expect(received[0]?.headers['x-mynto-delivery']).not.toBe(
      received[1]?.headers['x-mynto-delivery'],
    );
    expect(
      verifyWebhookSignature({
        secret: ep.secret,
        header: String(received[1]?.headers['x-mynto-signature']),
        rawBody: received[1]?.body ?? '',
      }),
    ).toBe(true);
  });
});
