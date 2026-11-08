import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { FullAuditPoller } from './_components/FullAuditPoller';
import { ReportBrandHeader, ReportFooter } from './_components/ReportBrand';
import { TemplateReport } from './_components/TemplateReport';

import { recordAuditView } from '@/lib/audit-views';
import { getAdminSession } from '@/lib/auth/admin';
import { getBranding, type Branding } from '@/lib/branding';
import { getFullAuditBySlug, getFullAuditFindingsBySlug } from '@/lib/db/queries-full';
import { publicUrl } from '@/lib/env';
import { isRadarAuditSlug } from '@/lib/radar/resolve-token';
import { renderAuditReport } from '@/lib/reports/render';
import { hostOf, score100 } from '@/lib/scores';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const result = await getFullAuditBySlug(slug);
  // AI-readable, search-engine-blocked report.
  const baseMetadata: Metadata = {
    robots: { googleBot: { index: false, follow: false } },
    other: {
      bingbot: 'noindex,nofollow',
      yandex: 'noindex,nofollow',
      duckduckbot: 'noindex,nofollow',
      slurp: 'noindex,nofollow',
      baiduspider: 'noindex,nofollow',
    },
  };
  if (result.kind !== 'ok') return baseMetadata;
  if (await isRadarAuditSlug(slug)) return baseMetadata;
  const audit = result.audit;
  const agency = (await getBranding()).name;
  const host = hostOf(audit.url);
  const score = score100(audit.global_score);
  const scoreText = score === null ? '' : ` (${String(score)}/100)`;
  return {
    ...baseMetadata,
    title: `Audit ${agency} : ${host}${scoreText}`,
    description: audit.exec_summary ?? `Audit complet sur 8 axes pour ${host}.`,
    openGraph: {
      title: `Audit ${agency} : ${host}`,
      description:
        score === null ? 'Audit web sur 8 axes.' : `Score global ${String(score)}/100 sur 8 axes.`,
      type: 'website',
    },
    twitter: { card: 'summary_large_image', title: `Audit ${agency} : ${host}` },
  };
}

export default async function FullAuditPage({
  params,
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const { slug } = await params;
  const result = await getFullAuditBySlug(slug);
  const brand = await getBranding();

  // Radar reports live behind /r/<token> only.
  if (result.kind === 'not_found' || (result.kind === 'ok' && (await isRadarAuditSlug(slug)))) {
    notFound();
  }
  if (result.kind === 'error') {
    return (
      <Shell brand={brand}>
        <h1 className="text-xl font-semibold">Erreur de chargement</h1>
        <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
          Impossible de charger le rapport pour le moment. Réessaye dans quelques instants.
        </p>
      </Shell>
    );
  }
  const audit = result.audit;

  if (audit.status !== 'completed') {
    return (
      <Shell brand={brand}>
        <FullAuditPoller slug={slug} createdAt={audit.created_at} initialStatus={audit.status} />
      </Shell>
    );
  }

  const findings = await getFullAuditFindingsBySlug(slug);

  // Best-effort view tracking (CNIL-simplified, lib/audit-views.ts). The
  // agency's own visits never count: ?preview=1 or a valid admin session.
  const preview = (await searchParams).preview === '1';
  if (!preview && (await getAdminSession()) === null) {
    void recordAuditView({ slug, headers: await headers() });
  }

  const report = await renderAuditReport({
    audit,
    findings,
    mode: 'web',
    shareUrl: `${publicUrl()}/audit/full/${slug}`,
    tracking: false,
  });
  return (
    <main id="main">
      <TemplateReport html={report.html} css={report.css} />
    </main>
  );
}

function Shell({
  brand,
  children,
}: {
  brand: Branding;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <main id="main" className="mx-auto max-w-3xl bg-white px-6 py-8 sm:py-12">
      <ReportBrandHeader brand={brand} />
      {children}
      <ReportFooter brand={brand} />
    </main>
  );
}
