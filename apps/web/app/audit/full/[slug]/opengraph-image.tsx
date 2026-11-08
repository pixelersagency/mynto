import { SLUG_PATTERN } from '@mynto/shared';
import { ImageResponse } from 'next/og';

import { getBranding } from '@/lib/branding';
import { readableTextOn } from '@/lib/color';
import { getFullAuditBySlug } from '@/lib/db/queries-full';
import { score100 } from '@/lib/scores';

export const runtime = 'nodejs';
export const revalidate = 3600;
export const alt = 'Audit web complet';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface Props {
  params: Promise<{ slug: string }>;
}

function scoreColor(score: number): string {
  if (score >= 80) return '#15803d';
  if (score >= 50) return '#b45309';
  return '#b91c1c';
}

function bandLabel(score: number | null): string {
  if (score === null) return 'En cours';
  return score >= 80 ? 'Bon' : score >= 50 ? 'À améliorer' : 'Critique';
}

export default async function OgImage({ params }: Props): Promise<ImageResponse> {
  const { slug } = await params;
  const validSlug = SLUG_PATTERN.test(slug);
  const result = validSlug ? await getFullAuditBySlug(slug) : { kind: 'not_found' as const };

  const brand = await getBranding();
  const hasAudit = result.kind === 'ok' && result.audit.status === 'completed';
  const score = hasAudit ? (score100(result.audit.global_score) ?? 0) : 0;
  const url = hasAudit ? result.audit.url : (brand.websiteHost ?? brand.name);
  const band = hasAudit ? score : null;
  const sector = hasAudit ? (result.audit.sector ?? '') : '';

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
        padding: '80px',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <div
          style={{
            width: '48px',
            height: '48px',
            borderRadius: '12px',
            background: brand.primaryColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: readableTextOn(brand.primaryColor),
            fontSize: '28px',
            fontWeight: 700,
          }}
        >
          {brand.name.charAt(0).toUpperCase()}
        </div>
        <span style={{ fontSize: '32px', fontWeight: 600, color: '#0f172a' }}>{brand.name}</span>
      </div>

      <div
        style={{
          marginTop: '60px',
          display: 'flex',
          alignItems: 'center',
          gap: '60px',
          flex: 1,
        }}
      >
        {hasAudit ? (
          <div
            style={{
              width: '280px',
              height: '280px',
              borderRadius: '50%',
              background: 'white',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              border: `12px solid ${scoreColor(score)}`,
              boxShadow: '0 20px 40px rgba(15, 23, 42, 0.08)',
            }}
          >
            <span style={{ fontSize: '110px', fontWeight: 700, color: '#0f172a' }}>
              {String(score)}
            </span>
            <span style={{ fontSize: '24px', color: '#475569' }}>/ 100</span>
          </div>
        ) : (
          <div
            style={{
              width: '280px',
              height: '280px',
              borderRadius: '50%',
              background: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '12px solid #1e3a8a',
              fontSize: '40px',
              color: '#475569',
            }}
          >
            En cours
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '20px' }}>
          <span
            style={{
              fontSize: '28px',
              color: scoreColor(score),
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '2px',
            }}
          >
            {bandLabel(band)}
          </span>
          <span
            style={{
              fontSize: '52px',
              fontWeight: 700,
              color: '#0f172a',
              lineHeight: 1.1,
            }}
          >
            Audit complet sur 8 axes
          </span>
          <span style={{ fontSize: '28px', color: '#334155', wordBreak: 'break-all' }}>{url}</span>
          {sector ? (
            <span style={{ fontSize: '22px', color: '#64748b' }}>Secteur détecté : {sector}</span>
          ) : null}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderTop: '1px solid #cbd5e1',
          paddingTop: '32px',
          fontSize: '22px',
          color: '#64748b',
        }}
      >
        <span>SEO · Performance · Accessibilité · Conformité · Conversion · UX · UI · Contenu</span>
        <span>{brand.websiteHost ?? brand.name}</span>
      </div>
    </div>,
    { ...size },
  );
}
