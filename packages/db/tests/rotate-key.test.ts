import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { SMTP_PASSWORD_AAD } from '../src/repos/email.js';
import { webhookSecretAad } from '../src/repos/webhooks.js';
import { RotationError, rotateEncryptionKey } from '../src/rotate-key.js';
import { decryptSecret, encryptSecret } from '../src/secrets.js';

import { hasDatabase, testSlug, useTestDb } from './helpers.js';

const OLD = randomBytes(32).toString('base64');
const NEW = randomBytes(32).toString('hex');

describe.skipIf(!hasDatabase)('APP_ENCRYPTION_KEY rotation', () => {
  const t = useTestDb();

  async function seed(): Promise<string> {
    await t.repos.ai.setKey(
      'anthropic',
      encryptSecret('sk-ant-test-key-1', OLD, 'anthropic'),
      '…ey-1',
    );
    await t.repos.ai.setKey(
      'mistral',
      encryptSecret('mistral-test-key-2', OLD, 'mistral'),
      '…ey-2',
    );
    await t.repos.email.saveSmtp(
      {
        host: 'smtp.example.com',
        port: 587,
        security: 'starttls',
        username: 'agence',
        from_name: 'Atelier',
        from_email: 'bonjour@atelier.fr',
        reply_to: null,
        subject_template: 'Audit de {site}',
        body_template: 'Lien : {lien}',
      },
      { ciphertext: encryptSecret('smtp-password', OLD, SMTP_PASSWORD_AAD), hint: '…word' },
    );
    const id = '7f1c2a3b-0000-4000-8000-000000000001';
    await t.repos.webhooks.create({
      id,
      url: 'https://hooks.example.com/mynto',
      events: ['audit.completed'] as never,
      secretCiphertext: encryptSecret('whsec_test_secret', OLD, webhookSecretAad(id)),
      secretHint: '…cret',
    });
    return id;
  }

  it('re-encrypts AI keys, SMTP password and webhook secrets with the new key', async () => {
    const hookId = await seed();
    const r = await rotateEncryptionKey(t.sql, OLD, NEW);
    expect(r).toEqual({
      aiKeys: { rotated: 2, alreadyNew: 0 },
      smtp: { rotated: 1, alreadyNew: 0 },
      webhooks: { rotated: 1, alreadyNew: 0 },
    });

    const [ai] = await t.sql<{ ciphertext: string }[]>`
      select ciphertext from ai_provider_keys where provider = 'anthropic'`;
    expect(decryptSecret(ai?.ciphertext ?? '', NEW, 'anthropic')).toBe('sk-ant-test-key-1');
    expect(() => decryptSecret(ai?.ciphertext ?? '', OLD, 'anthropic')).toThrow();

    const smtp = await t.repos.email.getSmtpSecret();
    expect(decryptSecret(smtp?.password_ciphertext ?? '', NEW, SMTP_PASSWORD_AAD)).toBe(
      'smtp-password',
    );
    const [hook] = await t.sql<{ secret_ciphertext: string }[]>`
      select secret_ciphertext from webhook_endpoints where id = ${hookId}`;
    expect(decryptSecret(hook?.secret_ciphertext ?? '', NEW, webhookSecretAad(hookId))).toBe(
      'whsec_test_secret',
    );

    // Second run: nothing left to do, nothing broken.
    const again = await rotateEncryptionKey(t.sql, OLD, NEW);
    expect(again.aiKeys).toEqual({ rotated: 0, alreadyNew: 2 });
    expect(again.webhooks).toEqual({ rotated: 0, alreadyNew: 1 });
  });

  it('writes nothing when one value opens with neither key', async () => {
    await seed();
    const stranger = randomBytes(32).toString('base64');
    await t.repos.ai.setKey('gemini', encryptSecret('gemini-key-xyz', stranger, 'gemini'), '…-xyz');
    const before = await t.sql`select provider, ciphertext from ai_provider_keys order by provider`;
    await expect(rotateEncryptionKey(t.sql, OLD, NEW)).rejects.toBeInstanceOf(RotationError);
    const after = await t.sql`select provider, ciphertext from ai_provider_keys order by provider`;
    expect(after).toEqual(before);
  });

  it('refuses identical or malformed keys', async () => {
    await expect(rotateEncryptionKey(t.sql, OLD, OLD)).rejects.toBeInstanceOf(RotationError);
    await expect(rotateEncryptionKey(t.sql, OLD, 'too-short')).rejects.toThrow(/32 bytes/);
  });
});

describe.skipIf(!hasDatabase)('audit_views purge', () => {
  const t = useTestDb();

  it('deletes views older than the retention, keeps the recent ones', async () => {
    const a = await t.repos.dashboard.createAuditWithLink(
      { slug: testSlug(), url: 'https://acme.fr/', label: null },
      { domain: 'acme.fr', trackingToken: `tok${'v'.repeat(30)}` },
    );
    await t.sql`
      insert into audit_views (audit_id, user_agent, ip_hash, viewed_at) values
        (${a.auditId}, 'Chrome', 'h1', now() - interval '120 days'),
        (${a.auditId}, 'Chrome', 'h2', now() - interval '91 days'),
        (${a.auditId}, 'Firefox', 'h3', now() - interval '2 days')
    `;
    expect(await t.repos.views.purgeOld()).toBe(2);
    const [left] = await t.sql<{ n: number }[]>`select count(*)::int as n from audit_views`;
    expect(left?.n).toBe(1);
  });
});
