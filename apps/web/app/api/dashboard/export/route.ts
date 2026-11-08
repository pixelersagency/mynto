import type { DashboardAuditRow } from '@mynto/db';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { getAdminSession } from '@/lib/auth/admin';
import {
  AXIS_LONG,
  SOURCE_LABEL,
  STATUS_LABEL,
  displayStatus,
  reportUrl,
  score100,
  toCsv,
  weakAxes,
} from '@/lib/dashboard/format';
import { parseListParams, toRepoFilter } from '@/lib/dashboard/params';
import { db, pgErrorCode } from '@/lib/db';
import { publicUrl } from '@/lib/env';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROWS = 5000;
const IdsSchema = z.array(z.string().uuid()).min(1).max(100);

/**
 * CSV export of the audit list (same filters as /dashboard, or `ids=` for
 * a selection). Admin only: checked here too, not just in the middleware.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if ((await getAdminSession()) === null) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const raw: Record<string, string> = {};
  for (const [k, v] of sp.entries()) raw[k] = v;

  let rows: DashboardAuditRow[];
  try {
    const idsParam = sp.get('ids');
    if (idsParam !== null) {
      const ids = IdsSchema.safeParse(idsParam.split(','));
      if (!ids.success) return NextResponse.json({ error: 'invalid_ids' }, { status: 400 });
      const all = await db().dashboard.listAudits({ limit: MAX_ROWS });
      const wanted = new Set(ids.data);
      rows = all.rows.filter((r) => wanted.has(r.id));
    } else {
      const filter = toRepoFilter(parseListParams(raw));
      rows = (await db().dashboard.listAudits({ ...filter, limit: MAX_ROWS, offset: 0 })).rows;
    }
  } catch (err) {
    logger.error({ code: pgErrorCode(err) }, 'dashboard_export_failed');
    return NextResponse.json({ error: 'export_failed' }, { status: 500 });
  }

  const base = publicUrl();
  const csv = toCsv(
    [
      'Site',
      'URL',
      'Libellé',
      'Statut',
      'Score /100',
      'Créé le',
      'Pages',
      'Axes faibles',
      'Source',
      'Ouvertures',
      'Dernière ouverture',
      'Lien du rapport',
    ],
    rows.map((r) => {
      const status = displayStatus(r.status, r.expires_at);
      return [
        new URL(r.url).host,
        r.url,
        r.label,
        STATUS_LABEL[status],
        status === 'completed' ? score100(r.global_score) : null,
        r.created_at,
        r.pages,
        weakAxes(r.axis_scores, 8)
          .map((a) => AXIS_LONG[a])
          .join(' / '),
        SOURCE_LABEL[r.source] ?? r.source,
        r.views_count,
        r.last_viewed_at,
        reportUrl(base, r),
      ];
    }),
  );
  const date = new Date().toISOString().slice(0, 10);
  // BOM so Excel opens the UTF-8 file with the right accents.
  return new NextResponse(`${String.fromCharCode(0xfeff)}${csv}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="audits-${date}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  });
}
