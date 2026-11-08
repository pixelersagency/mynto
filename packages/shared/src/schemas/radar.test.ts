import { describe, expect, it } from 'vitest';

import { RadarCreateAuditRequestSchema, RadarViewBeaconSchema } from './radar.js';

describe('RadarCreateAuditRequestSchema', () => {
  it('accepts a url and a Radar prospect id', () => {
    expect(
      RadarCreateAuditRequestSchema.safeParse({
        url: 'https://atelier-lumiere.fr',
        external_ref: 'cmp_01JABCDEF',
      }).success,
    ).toBe(true);
  });

  it('rejects odd external refs and non-urls', () => {
    expect(
      RadarCreateAuditRequestSchema.safeParse({ url: 'https://a.fr', external_ref: 'a b' }).success,
    ).toBe(false);
    expect(
      RadarCreateAuditRequestSchema.safeParse({ url: 'pas une url', external_ref: 'cmp_1' })
        .success,
    ).toBe(false);
  });
});

describe('RadarViewBeaconSchema', () => {
  const token = 'abcdefghijklmnopqrstuvwxyz012345';

  it('keeps only the token', () => {
    expect(RadarViewBeaconSchema.parse({ token })).toEqual({ token });
  });

  it('drops the legacy fields of cached pages', () => {
    expect(
      RadarViewBeaconSchema.parse({
        token,
        session_id: 'sess_12345678',
        duration_s: 6,
        sections_viewed: ['seo'],
        final: true,
      }),
    ).toEqual({ token });
  });

  it('rejects short or odd tokens', () => {
    expect(RadarViewBeaconSchema.safeParse({ token: 'court' }).success).toBe(false);
    expect(RadarViewBeaconSchema.safeParse({ token: `${token}<` }).success).toBe(false);
    expect(RadarViewBeaconSchema.safeParse({}).success).toBe(false);
  });
});
