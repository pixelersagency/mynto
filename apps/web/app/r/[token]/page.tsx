import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { FullAuditPoller } from '../../audit/full/[slug]/_components/FullAuditPoller';
import { ReportBrandHeader, ReportFooter } from '../../audit/full/[slug]/_components/ReportBrand';
import { TemplateReport } from '../../audit/full/[slug]/_components/TemplateReport';

import { RadarViewBeacon } from './_components/RadarViewBeacon';

import { getAdminSession } from '@/lib/auth/admin';
import { getBranding, type Branding } from '@/lib/branding';
import { getFullAuditBySlug, getFullAuditFindingsBySlug } from '@/lib/db/queries-full';
import { publicUrl } from '@/lib/env';
import { resolveRadarToken } from '@/lib/radar/resolve-token';
import { renderAuditReport } from '@/lib/reports/render';

/**
 * Tracking link: /r/<token> (dashboard and Radar links).
 *
 * Same report as /audit/full/[slug], reached through a per-prospect token
 * (resolved server-side from the database, only the slug comes
 * out). Differences with the public report:
 *   - "opened" is recorded by the client beacon only, once, after JS + 5 s
 *     of visible tab (RadarViewBeacon); it sends the token and nothing
 *     else. A visible notice says so (CNIL art. 82). The admin's own visits
 *     (session cookie) and ?preview=1 never count;
 *   - noindex for every bot, no referrer leak of the token.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ token: string }>;
}

const NO_INDEX = 'noindex,nofollow,noarchive,nosnippet';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const base: Metadata = {
    title: 'Audit web',
    robots: {
      index: false,
      follow: false,
      nocache: true,
      googleBot: { index: false, follow: false, noimageindex: true },
    },
    referrer: 'no-referrer',
    other: {
      bingbot: NO_INDEX,
      yandex: NO_INDEX,
      duckduckbot: NO_INDEX,
      slurp: NO_INDEX,
      baiduspider: NO_INDEX,
      GPTBot: NO_INDEX,
      ClaudeBot: NO_INDEX,
      PerplexityBot: NO_INDEX,
    },
  };
  const resolved = await resolveRadarToken(token);
  if (resolved.kind !== 'ok') return base;
  const result = await getFullAuditBySlug(resolved.slug);
  if (result.kind !== 'ok') return base;
  const host = (() => {
    try {
      return new URL(result.audit.url).host;
    } catch {
      return result.audit.url;
    }
  })();
  return { ...base, title: `Audit ${(await getBranding()).name} : ${host}` };
}

export default async function RadarAuditPage({ params }: PageProps): Promise<React.ReactElement> {
  const { token } = await params;
  const brand = await getBranding();
  const resolved = await resolveRadarToken(token);
  if (resolved.kind === 'not_found') notFound();
  if (resolved.kind === 'error') return <ErrorShell brand={brand} />;

  const result = await getFullAuditBySlug(resolved.slug);
  if (result.kind === 'not_found') notFound();
  if (result.kind === 'error') return <ErrorShell brand={brand} />;

  const audit = result.audit;
  if (new Date(audit.expires_at).getTime() < Date.now()) notFound();
  // The agency reading its own link (logged in) is not an opening.
  const isAdmin = (await getAdminSession()) !== null;

  if (audit.status !== 'completed') {
    return (
      <Shell brand={brand}>
        <FullAuditPoller
          slug={resolved.slug}
          createdAt={audit.created_at}
          initialStatus={audit.status}
        />
      </Shell>
    );
  }

  const findings = await getFullAuditFindingsBySlug(resolved.slug);
  const report = await renderAuditReport({
    audit,
    findings,
    mode: 'web',
    shareUrl: `${publicUrl()}/r/${token}`,
    tracking: true,
  });
  return (
    <main id="main">
      {isAdmin ? null : <RadarViewBeacon token={token} />}
      <TemplateReport html={report.html} css={report.css} />
    </main>
  );
}

function ErrorShell({ brand }: { brand: Branding }): React.ReactElement {
  return (
    <Shell brand={brand}>
      <h1 className="text-xl font-semibold">Erreur de chargement</h1>
      <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">
        Impossible de charger le rapport pour le moment. Réessaye dans quelques instants.
      </p>
    </Shell>
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
