import { describe, expect, it } from 'vitest';

import { fillEmailTemplate } from '../src/index.js';

import { hasDatabase, testSlug, useTestDb } from './helpers.js';

const tok = (c: string): string => c.repeat(32);

describe.skipIf(!hasDatabase)('phase 4c repos', () => {
  const t = useTestDb();

  async function dashAudit(url: string, token: string) {
    return t.repos.dashboard.createAuditWithLink(
      { slug: testSlug(), url, label: null },
      { domain: new URL(url).host, trackingToken: token },
    );
  }

  it('report settings: defaults, default template, fonts, custom font', async () => {
    expect((await t.repos.reports.getSettings()).default_template_id).toBe('minimal');
    await t.repos.reports.setDefaultTemplate('bento');
    await t.repos.reports.setFonts('fraunces', 'inter');
    const first = await t.repos.reports.setCustomFont({
      name: 'Marque Sans',
      regularKey: 'fonts/abcdefgh12.woff2',
      boldKey: null,
    });
    expect(first.previous).toEqual([]);
    const second = await t.repos.reports.setCustomFont({
      name: 'Marque Sans',
      regularKey: 'fonts/zzzzzzzz12.woff2',
      boldKey: 'fonts/yyyyyyyy12.woff2',
    });
    expect(second.previous).toEqual(['fonts/abcdefgh12.woff2']);
    const s = await t.repos.reports.getSettings();
    expect(s).toMatchObject({
      default_template_id: 'bento',
      heading_font: 'fraunces',
      body_font: 'inter',
      custom_font_name: 'Marque Sans',
    });
    await expect(t.repos.reports.setFonts('../x', 'inter')).rejects.toThrow();
    await expect(
      t.repos.reports.setCustomFont({ name: 'x', regularKey: '../../etc/passwd', boldKey: null }),
    ).rejects.toThrow();
  });

  it('custom templates and state: upsert, settings, delete resets audits and default', async () => {
    const res = await t.repos.reports.upsertCustom({
      id: 'maison',
      manifest: { id: 'maison' },
      files: { 'report.liquid': '<h1>x</h1>' },
      preview: null,
    });
    expect(res.created).toBe(true);
    expect(
      (await t.repos.reports.upsertCustom({ id: 'maison', manifest: {}, files: {}, preview: null }))
        .created,
    ).toBe(false);
    await t.repos.reports.setEnabled('maison', false);
    await t.repos.reports.saveTemplateSettings('maison', { density: 'compact' });
    expect(await t.repos.reports.getState('maison')).toMatchObject({
      enabled: false,
      settings: { density: 'compact' },
    });
    const a = await dashAudit('https://acme.fr/', tok('a'));
    await t.repos.reports.setAuditTemplate(a.auditId, 'maison');
    await t.repos.reports.setDefaultTemplate('maison');
    expect(await t.repos.reports.deleteCustom('maison')).toBe(true);
    const [row] = await t.sql<{ template_id: string | null }[]>`
      select template_id from audits_full where id = ${a.auditId}
    `;
    expect(row?.template_id).toBeNull();
    expect((await t.repos.reports.getSettings()).default_template_id).toBe('minimal');
    expect(await t.repos.reports.getState('maison')).toBeNull();
    await expect(
      t.sql`update audits_full set template_id = 'Bad Id' where id = ${a.auditId}`,
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('smtp: password kept, replaced or removed; public read hides the ciphertext', async () => {
    const input = {
      host: 'smtp.example.com',
      port: 587,
      security: 'starttls' as const,
      username: 'agence',
      from_name: 'Atelier',
      from_email: 'bonjour@atelier.fr',
      reply_to: null,
      subject_template: 'Audit de {site}',
      body_template: 'Lien : {lien}',
    };
    await t.repos.email.saveSmtp(input, {
      ciphertext: 'v1.cipher-text-long-enough',
      hint: '…abcd',
    });
    await t.repos.email.saveSmtp({ ...input, port: 465, security: 'tls' });
    const pub = await t.repos.email.getSmtp();
    expect(pub).toMatchObject({ port: 465, has_password: true, password_hint: '…abcd' });
    expect(pub).not.toHaveProperty('password_ciphertext');
    expect((await t.repos.email.getSmtpSecret())?.password_ciphertext).toBe(
      'v1.cipher-text-long-enough',
    );
    await t.repos.email.saveSmtp(input, null);
    expect((await t.repos.email.getSmtp())?.has_password).toBe(false);
  });

  it('email log follows the refresh chain; refresh keeps the template', async () => {
    const a = await dashAudit('https://acme.fr/', tok('b'));
    await t.repos.reports.setAuditTemplate(a.auditId, 'mynto');
    await t.repos.audits.update(a.auditId, { status: 'completed', global_score: 5 });
    await t.repos.email.logSend({
      auditId: a.auditId,
      recipient: 'client@acme.fr',
      subject: 'Audit',
      status: 'sent',
    });
    const r = await t.repos.dashboard.refreshAudit(a.auditId, {
      slug: testSlug(),
      url: 'https://acme.fr/',
    });
    if (r.kind !== 'ok') throw new Error('refresh');
    await t.repos.audits.update(r.newAuditId, { status: 'completed', global_score: 6.5 });
    const [n] = await t.sql<{ template_id: string }[]>`
      select template_id from audits_full where id = ${r.newAuditId}
    `;
    expect(n?.template_id).toBe('mynto');
    expect(await t.repos.email.listSends(r.newAuditId)).toHaveLength(1);
    expect(await t.repos.email.countRecent(5)).toBe(1);

    const history = await t.repos.dashboard.history(r.newAuditId);
    expect(history.map((h) => h.global_score)).toEqual([5, 6.5]);
    const { rows } = await t.repos.dashboard.listAudits({});
    expect(rows[0]?.prev_score).toBe(5);
  });

  it('opens, todo lists and week stats', async () => {
    const a = await dashAudit('https://open.fr/', tok('c'));
    await t.repos.audits.update(a.auditId, { status: 'completed', global_score: 7 });
    await t.sql`
      insert into radar_audit_views (radar_audit_id, user_agent)
      values (${a.linkId}, 'Chrome, ordinateur'), (${a.linkId}, 'Safari, mobile')
    `;
    await t.sql`update radar_audits set views_count = 2, last_viewed_at = now() where id = ${a.linkId}`;
    const f = await dashAudit('https://fail.fr/', tok('d'));
    await t.repos.audits.update(f.auditId, { status: 'failed' });
    const e = await dashAudit('https://soon.fr/', tok('e'));
    await t.repos.audits.update(e.auditId, { status: 'completed' });
    await t.sql`update audits_full set expires_at = now() + interval '3 days' where id = ${e.auditId}`;

    const opens = await t.repos.dashboard.opens(a.auditId);
    expect(opens.rows).toHaveLength(2);
    expect(opens.first).not.toBeNull();
    const todo = await t.repos.dashboard.todo();
    expect(todo.opened.map((x) => x.url)).toEqual(['https://open.fr/']);
    expect(todo.failed.map((x) => x.url)).toEqual(['https://fail.fr/']);
    expect(todo.expiring.map((x) => x.url)).toEqual(['https://soon.fr/']);
    const w = await t.repos.dashboard.weekStats();
    expect(w).toMatchObject({ audits: 3, opens: 2, audits_prev: 0 });
    expect(w.avg_score).toBeCloseTo(7);
  });

  it('fills email templates without touching unknown braces', () => {
    expect(
      fillEmailTemplate('{site} {score}/100 {lien} {agence} {autre}', {
        site: 'acme.fr',
        score: '72',
        lien: 'https://x/r/t',
        agence: 'Atelier',
      }),
    ).toBe('acme.fr 72/100 https://x/r/t Atelier {autre}');
  });
});
