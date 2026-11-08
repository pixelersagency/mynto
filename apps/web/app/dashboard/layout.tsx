import type { Metadata } from 'next';

import { DashShell, type ShellCounts } from './_components/DashShell';
import { THEME_SCRIPT } from './_components/theme';

import { requireAdmin } from '@/lib/auth/admin';
import { getBranding } from '@/lib/branding';
import { currentMonth, monthBounds } from '@/lib/dashboard/params';
import { db, pgErrorCode } from '@/lib/db';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: { default: 'Audits', template: '%s | Tableau de bord' },
  robots: { index: false, follow: false },
};

async function loadCounts(): Promise<ShellCounts | null> {
  try {
    return await db().dashboard.counts(monthBounds(currentMonth()).from);
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'dashboard_counts_failed');
    return null;
  }
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const session = await requireAdmin();
  const [brand, counts] = await Promise.all([getBranding(), loadCounts()]);
  return (
    <div className="dash min-h-screen">
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <DashShell
        agencyName={brand.name}
        logoUrl={brand.logoUrl}
        adminEmail={session.email}
        counts={counts}
      >
        {children}
      </DashShell>
    </div>
  );
}
