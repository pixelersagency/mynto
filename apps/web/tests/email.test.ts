import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { SmtpError, sendMail, textToHtml } = await import('../lib/email/smtp');

describe('report email', () => {
  it('turns the text body into escaped HTML with clickable links', () => {
    const html = textToHtml('Bonjour <b>Léa</b>,\n\nLe rapport : https://audit.test/r/abc');
    expect(html).toContain('&#60;b&#62;Léa');
    expect(html).toContain('<a href="https://audit.test/r/abc">https://audit.test/r/abc</a>');
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  it('refuses to send without SMTP settings', async () => {
    await expect(sendMail(null, { to: 'a@b.fr', subject: 's', text: 't' })).rejects.toBeInstanceOf(
      SmtpError,
    );
  });
});
