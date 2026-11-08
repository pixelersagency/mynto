import type { Metadata } from 'next';

import { AuditsView } from './_components/AuditsView';

export const metadata: Metadata = { title: 'Audits' };

export default async function AuditsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.ReactElement> {
  return <AuditsView raw={await searchParams} />;
}
