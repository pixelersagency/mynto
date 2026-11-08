import { describe, expect, it } from 'vitest';

import { AgencySettingsInputSchema } from '../src/repos/settings.js';

const base = {
  name: 'Agence',
  website_url: '',
  contact_url: '',
  primary_color: '',
  report_footer: '',
  daily_rate_eur: '',
};

describe('AgencySettingsInputSchema', () => {
  it('turns empty strings into null and coerces the daily rate', () => {
    const v = AgencySettingsInputSchema.parse({ ...base, daily_rate_eur: '650' });
    expect(v).toEqual({
      name: 'Agence',
      website_url: null,
      contact_url: null,
      primary_color: null,
      report_footer: null,
      daily_rate_eur: 650,
    });
  });

  it('accepts https links, mailto contacts and #RRGGBB colors', () => {
    const r = AgencySettingsInputSchema.safeParse({
      ...base,
      website_url: 'https://agence.fr',
      contact_url: 'mailto:hello@agence.fr',
      primary_color: '#1a2B3c',
    });
    expect(r.success).toBe(true);
  });

  it.each([
    ['name', ''],
    ['name', 'x'.repeat(81)],
    ['website_url', 'javascript:alert(1)'],
    ['website_url', 'ftp://agence.fr'],
    ['contact_url', 'mailto:pas-un-email'],
    ['contact_url', 'data:text/html,hi'],
    ['primary_color', 'red'],
    ['primary_color', '#fff'],
    ['report_footer', 'x'.repeat(501)],
    ['daily_rate_eur', '12.5'],
    ['daily_rate_eur', '-1'],
    ['daily_rate_eur', '20000'],
  ])('rejects %s = %s', (field, value) => {
    expect(AgencySettingsInputSchema.safeParse({ ...base, [field]: value }).success).toBe(false);
  });
});
