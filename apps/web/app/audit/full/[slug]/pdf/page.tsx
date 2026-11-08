import { notFound } from 'next/navigation';

import { TemplateReport } from '../_components/TemplateReport';

import { getFullAuditBySlug, getFullAuditFindingsBySlug } from '@/lib/db/queries-full';
import { publicUrl } from '@/lib/env';
import { renderAuditReport } from '@/lib/reports/render';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export const dynamic = 'force-dynamic';

/**
 * Printed by the scanner (Playwright) for the PDF export. Same template and
 * engine as the web report, in print mode (sections expanded, cover page).
 */
export default async function FullAuditPdfPage({ params }: PageProps): Promise<React.ReactElement> {
  const { slug } = await params;
  const result = await getFullAuditBySlug(slug);
  if (result.kind !== 'ok') notFound();
  const audit = result.audit;
  if (audit.status !== 'completed') notFound();
  const findings = await getFullAuditFindingsBySlug(slug);
  const report = await renderAuditReport({
    audit,
    findings,
    mode: 'print',
    shareUrl: `${publicUrl()}/audit/full/${slug}`,
    tracking: false,
  });
  return (
    <main id="main">
      <TemplateReport html={report.html} css={report.css} />
    </main>
  );
}
