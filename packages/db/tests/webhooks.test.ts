import { WEBHOOK_AUTO_DISABLE_AFTER, type WebhookPayload } from '@mynto/shared';
import { describe, expect, it } from 'vitest';

import { type AttemptResult } from '../src/index.js';

import { hasDatabase, testSlug, useTestDb } from './helpers.js';

const tok = (c: string): string => c.repeat(32);
const BASE = 'https://audit.agence.fr';

const OK: AttemptResult = {
  ok: true,
  statusCode: 200,
  error: null,
  durationMs: 12,
  responseBody: 'ok',
  retryable: false,
};
const FAIL_500: AttemptResult = {
  ok: false,
  statusCode: 500,
  error: 'http_500',
  durationMs: 8,
  responseBody: 'boom',
  retryable: true,
};
const FAIL_FINAL: AttemptResult = { ...FAIL_500, statusCode: 410, retryable: false };

describe.skipIf(!hasDatabase)('webhooks repo', () => {
  const t = useTestDb();

  async function endpoint(events: string[], extra: { active?: boolean } = {}) {
    return t.repos.webhooks.create({
      url: 'https://hooks.example.com/mynto',
      events: events as never,
      secretCiphertext: 'v1.cipher-placeholder-xxxxxxxx',
      secretHint: '…abcd',
      ...extra,
    });
  }

  async function dashboardAudit() {
    return t.repos.dashboard.createAuditWithLink(
      { slug: testSlug(), url: 'https://client.example.com', label: 'Client Martin' },
      { domain: 'client.example.com', trackingToken: tok('k') },
    );
  }

  async function eventsOf(type?: string) {
    return t.sql<{ id: string; type: string; snapshot: Record<string, unknown> }[]>`
      select id, type, snapshot from webhook_events
       where ${type ?? null}::text is null or type = ${type ?? null}
       order by created_at, id
    `;
  }

  it('writes nothing when no endpoint subscribes', async () => {
    await dashboardAudit();
    expect(await eventsOf()).toHaveLength(0);
  });

  it('audit.created is written in the creation transaction, then fanned out', async () => {
    const ep = await endpoint(['audit.created']);
    const created = await dashboardAudit();
    const [ev] = await eventsOf('audit.created');
    expect(ev?.id).toMatch(/^evt_[0-9a-f]{24}$/);
    expect(ev?.snapshot).toMatchObject({ audit: { id: created.auditId, label: 'Client Martin' } });

    const ids = await t.repos.webhooks.fanOut(BASE);
    expect(ids).toHaveLength(1);
    // Idempotent: dispatched events are not fanned out twice.
    expect(await t.repos.webhooks.fanOut(BASE)).toHaveLength(0);

    const d = await t.repos.webhooks.getDelivery(ids[0] ?? '');
    expect(d?.endpoint_id).toBe(ep.id);
    expect(d?.format).toBe('standard');
    const body = JSON.parse(d?.request_body ?? '{}') as WebhookPayload;
    expect(body).toMatchObject({
      id: ev?.id,
      type: 'audit.created',
      api_version: '2026-11-01',
      data: {
        audit: { id: created.auditId, status: 'queued', source: 'dashboard', score: null },
        link: { url: `${BASE}/r/${tok('k')}`, views_count: 0, first_opened_at: null },
      },
    });
    expect(body.data.report_url).toMatch(/^https:\/\/audit\.agence\.fr\/audit\/full\//);
    // Nothing personal: no contact email, no IP, no user agent.
    expect(d?.request_body).not.toMatch(/email|ip_hash|user_agent/);
  });

  it('a rolled back state change leaves no event', async () => {
    await endpoint(['audit.created']);
    await t.sql
      .begin(async (tx) => {
        await tx`insert into webhook_events (id, type, snapshot) values ('evt_000000000000000000000000', 'audit.created', '{}'::jsonb)`;
        throw new Error('rollback');
      })
      .catch(() => undefined);
    expect(await eventsOf()).toHaveLength(0);
  });

  it('finish: audit.completed with score and ai_score, audit.refreshed after a refresh', async () => {
    await endpoint(['audit.completed', 'audit.refreshed', 'audit.failed']);
    const { auditId } = await dashboardAudit();
    await t.repos.audits.finish(auditId, { status: 'completed', global_score: 7.24, ai_score: 61 });
    const [done] = await eventsOf('audit.completed');
    expect(done?.snapshot).toMatchObject({ audit: { global_score: 7.24, ai_score: 61 } });

    const ref = await t.repos.dashboard.refreshAudit(auditId, {
      slug: testSlug(),
      url: 'https://client.example.com',
      source: 'dashboard',
    });
    if (ref.kind !== 'ok') throw new Error('refresh');
    await t.repos.audits.finish(ref.newAuditId, { status: 'completed', global_score: 8 });
    const [refreshed] = await eventsOf('audit.refreshed');
    expect(refreshed?.snapshot).toMatchObject({
      audit: { id: ref.newAuditId, previous_id: auditId },
    });
    await t.repos.audits.finish(auditId, { status: 'failed', llm_error: 'x' });
    expect(await eventsOf('audit.failed')).toHaveLength(1);

    await t.repos.webhooks.fanOut(BASE);
    const [row] = await t.sql<{ request_body: string }[]>`
      select d.request_body from webhook_deliveries d join webhook_events e on e.id = d.event_id
       where e.type = 'audit.completed'
    `;
    const body = JSON.parse(row?.request_body ?? '{}') as WebhookPayload;
    expect(body.data.audit).toMatchObject({ score: 72, ai_score: 61, status: 'completed' });
  });

  it('audit.deleted carries the audit as it was', async () => {
    await endpoint(['audit.deleted']);
    const { auditId } = await dashboardAudit();
    const deleted = await t.repos.dashboard.deleteAudit(auditId);
    expect(deleted).toHaveLength(1);
    const [ev] = await eventsOf('audit.deleted');
    expect(ev?.snapshot).toMatchObject({
      audit: { id: auditId, url: 'https://client.example.com' },
    });
    await t.repos.webhooks.fanOut(BASE);
    const [row] = await t.sql<
      { request_body: string }[]
    >`select request_body from webhook_deliveries`;
    expect((JSON.parse(row?.request_body ?? '{}') as WebhookPayload).data.report_url).toBeNull();
    // Unknown id: nothing deleted, no event.
    expect(await t.repos.dashboard.deleteAudit('00000000-0000-4000-8000-000000000000')).toEqual([]);
    expect(await eventsOf('audit.deleted')).toHaveLength(1);
  });

  it('link.first_opened once, link.opened on every counted view', async () => {
    await endpoint(['link.first_opened', 'link.opened']);
    const { linkId } = await dashboardAudit();
    const view = (ip: string, at: string) =>
      t.repos.radar.recordView({
        radarAuditId: linkId,
        ipHash: ip,
        userAgent: 'Chrome, ordinateur',
        viewedAt: at,
        dedupeWindowMs: 30 * 60_000,
      });
    await view('a', '2026-11-06T10:00:00.000Z');
    await view('a', '2026-11-06T10:05:00.000Z'); // deduped
    await view('b', '2026-11-06T10:06:00.000Z');
    expect(await eventsOf('link.first_opened')).toHaveLength(1);
    const opened = await eventsOf('link.opened');
    expect(opened).toHaveLength(2);
    expect(opened[1]?.snapshot).toMatchObject({
      occurred_at: '2026-11-06T10:06:00.000Z',
      link: { views_count: 2, first_opened_at: '2026-11-06T10:00:00.000Z' },
    });
    expect(JSON.stringify(opened)).not.toMatch(/Chrome|ip_hash/);
  });

  it('legacy Radar endpoint gets the historical body, byte for byte', async () => {
    await t.repos.webhooks.syncRadarEndpoint('https://radar.example.com/webhooks/mynto');
    const created = await t.repos.radar.createScanWithLink(
      { slug: testSlug(), url: 'https://prospect.example.com/', source: 'radar' },
      {
        externalRef: 'ref-1',
        domain: 'prospect.example.com',
        trackingToken: tok('r'),
        reused: false,
      },
    );
    await t.repos.radar.recordView({
      radarAuditId: created.id,
      ipHash: 'h',
      userAgent: null,
      viewedAt: '2026-11-06T10:00:00.123Z',
      dedupeWindowMs: 1,
    });
    const ids = await t.repos.webhooks.fanOut(BASE);
    expect(ids).toHaveLength(1);
    const d = await t.repos.webhooks.getDelivery(ids[0] ?? '');
    expect(d?.format).toBe('legacy_radar');
    expect(d?.request_body).toBe(
      `{"tracking_token":"${tok('r')}","event":"audit_viewed","occurred_at":"2026-11-06T10:00:00.123Z","duration_s":0,"sections_viewed":[]}`,
    );
  });

  it('syncRadarEndpoint: created once, URL follows the env, switched off when removed', async () => {
    const a = await t.repos.webhooks.syncRadarEndpoint('https://radar.example.com/a');
    expect(a).toMatchObject({
      system_key: 'radar',
      legacy_radar_format: true,
      events: ['link.opened'],
      active: true,
    });
    await t.repos.webhooks.update(a?.id ?? '', { events: ['link.opened', 'audit.completed'] });
    const b = await t.repos.webhooks.syncRadarEndpoint('https://radar.example.com/b');
    expect(b?.id).toBe(a?.id);
    expect(b?.url).toBe('https://radar.example.com/b');
    expect(b?.events).toEqual(['link.opened', 'audit.completed']);
    const off = await t.repos.webhooks.syncRadarEndpoint(null);
    expect(off).toMatchObject({ active: false, disabled_reason: 'env_removed' });
    const back = await t.repos.webhooks.syncRadarEndpoint('https://radar.example.com/b');
    expect(back).toMatchObject({ active: true, disabled_reason: null });
    // The env-managed endpoint cannot be deleted nor have its URL changed.
    expect(await t.repos.webhooks.delete(a?.id ?? '')).toBe(false);
    expect(await t.repos.webhooks.update(a?.id ?? '', { url: 'https://x.example.com' })).toBeNull();
  });

  it('email.sent carries the recipient typed by the agency', async () => {
    await endpoint(['email.sent', 'email.failed']);
    const { auditId } = await dashboardAudit();
    await t.repos.email.logSend({
      auditId,
      recipient: 'prospect@client.fr',
      subject: 'Audit',
      status: 'sent',
    });
    await t.repos.email.logSend({
      auditId,
      recipient: 'prospect@client.fr',
      subject: 'Audit',
      status: 'failed',
      errorCode: 'auth',
    });
    const [failed] = await eventsOf('email.failed');
    expect(failed?.snapshot).toMatchObject({
      email: { recipient: 'prospect@client.fr', status: 'failed', error_code: 'auth' },
    });
    expect(await eventsOf('email.sent')).toHaveLength(1);
  });

  it('ping goes to its target only, even when it is off', async () => {
    const a = await endpoint(['audit.created'], { active: false });
    await endpoint(['audit.created']);
    const evt = await t.repos.webhooks.ping(a.id);
    expect(evt).toMatch(/^evt_/);
    const ids = await t.repos.webhooks.fanOut(BASE);
    expect(ids).toHaveLength(1);
    const claimed = await t.repos.webhooks.claim(ids[0] ?? '', 1);
    expect(claimed).toMatchObject({ endpoint_id: a.id, event_type: 'ping', endpoint_active: true });
  });

  it('claim is exclusive and attempt-bound', async () => {
    await endpoint(['audit.created']);
    await dashboardAudit();
    const [id] = await t.repos.webhooks.fanOut(BASE);
    expect(await t.repos.webhooks.listDue()).toEqual([{ id, attempt: 1 }]);
    const first = await t.repos.webhooks.claim(id ?? '', 1);
    expect(first?.attempt).toBe(1);
    expect(await t.repos.webhooks.claim(id ?? '', 1)).toBeNull(); // duplicate job
    expect(await t.repos.webhooks.claim(id ?? '', 2)).toBeNull(); // wrong attempt
    expect(await t.repos.webhooks.listDue()).toEqual([]); // locked
  });

  it('retry schedule, success resets the streak, resend keeps the event id', async () => {
    const ep = await endpoint(['audit.created']);
    await dashboardAudit();
    const [id = ''] = await t.repos.webhooks.fanOut(BASE);
    await t.repos.webhooks.claim(id, 1);
    const r1 = await t.repos.webhooks.recordAttempt(
      { id, attempt: 1, endpointId: ep.id },
      FAIL_500,
    );
    expect(r1).toEqual({ kind: 'retry', nextAttempt: 2, delayMs: 60_000 });
    const [row] = await t.sql<{ wait: number }[]>`
      select extract(epoch from next_attempt_at - now())::int as wait
        from webhook_deliveries where id = ${id}
    `;
    expect(row?.wait).toBeGreaterThan(50);
    // Not due yet.
    expect(await t.repos.webhooks.listDue()).toEqual([]);
    await t.sql`update webhook_deliveries set next_attempt_at = now() where id = ${id}`;
    expect(await t.repos.webhooks.claim(id, 2)).not.toBeNull();
    expect(await t.repos.webhooks.recordAttempt({ id, attempt: 2, endpointId: ep.id }, OK)).toEqual(
      {
        kind: 'success',
      },
    );
    const detail = await t.repos.webhooks.getDelivery(id);
    expect(detail?.status).toBe('success');
    expect(detail?.attempts_log.map((a) => a.status_code)).toEqual([500, 200]);
    expect((await t.repos.webhooks.get(ep.id))?.last_status).toBe('success');

    const again = await t.repos.webhooks.resend(id);
    const copy = await t.repos.webhooks.getDelivery(again ?? '');
    expect(copy).toMatchObject({ status: 'pending', manual: true, event_id: detail?.event_id });
    expect(copy?.request_body).toBe(detail?.request_body);
  });

  it(`switches the endpoint off after ${String(WEBHOOK_AUTO_DISABLE_AFTER)} final failures`, async () => {
    const ep = await endpoint(['audit.created']);
    await t.sql`update webhook_endpoints set consecutive_failures = ${WEBHOOK_AUTO_DISABLE_AFTER - 2} where id = ${ep.id}`;
    for (let i = 0; i < 2; i += 1) {
      await dashboardAudit().catch(() => undefined);
      await t.sql`delete from radar_audits`; // unique token: reuse it
    }
    const ids = await t.repos.webhooks.fanOut(BASE);
    expect(ids).toHaveLength(2);
    const o1 = await t.repos.webhooks.recordAttempt(
      { id: ids[0] ?? '', attempt: 1, endpointId: ep.id },
      FAIL_FINAL,
    );
    expect(o1).toEqual({ kind: 'failed', endpointDisabled: false });
    const o2 = await t.repos.webhooks.recordAttempt(
      { id: ids[1] ?? '', attempt: 6, endpointId: ep.id },
      FAIL_500,
    );
    expect(o2).toEqual({ kind: 'failed', endpointDisabled: true });
    const after = await t.repos.webhooks.get(ep.id);
    expect(after).toMatchObject({ active: false, disabled_reason: 'auto' });
    expect(await t.repos.webhooks.listAutoDisabled()).toHaveLength(1);
    // Switched off: new events are not fanned out to it.
    await dashboardAudit();
    expect(await t.repos.webhooks.fanOut(BASE)).toHaveLength(0);
    // Back on: streak cleared.
    const on = await t.repos.webhooks.update(ep.id, { active: true });
    expect(on).toMatchObject({ active: true, consecutive_failures: 0, disabled_reason: null });
  });

  it('purge keeps 30 days and pending deliveries', async () => {
    await endpoint(['audit.created']);
    await dashboardAudit();
    await t.repos.webhooks.fanOut(BASE);
    await t.sql`update webhook_events set created_at = now() - interval '31 days'`;
    await t.sql`update webhook_deliveries set created_at = now() - interval '31 days'`;
    expect(await t.repos.webhooks.purgeOld()).toEqual({ events: 0, deliveries: 0 });
    await t.sql`update webhook_deliveries set status = 'success'`;
    expect(await t.repos.webhooks.purgeOld()).toEqual({ events: 1, deliveries: 1 });
  });
});
