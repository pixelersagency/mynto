import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { AuditPanel } from '../_components/AuditPanel';
import { AuditsView } from '../_components/AuditsView';

import { isUuid } from '@/lib/db';

export const metadata: Metadata = { title: 'Fiche audit' };

/** Audits list with the side panel of one audit open (shareable URL). */
export default async function AuditRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const raw = await searchParams;
  return <AuditsView raw={raw} selectedId={id} panel={<AuditPanel id={id} raw={raw} />} />;
}
