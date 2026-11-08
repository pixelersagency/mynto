import { ApiAuditIdSchema } from '@mynto/shared';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiError, apiJson, serviceErrorResponse } from '@/lib/api/http';
import { refreshAudit } from '@/lib/services/audits';

export const dynamic = 'force-dynamic';

/** POST /api/v1/audits/{id}/refresh: rescan with the same modules and the same links. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const id = ApiAuditIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, 'not_found', 'Audit introuvable.');
  try {
    const out = await refreshAudit(id.data);
    return apiJson(out, out.refreshed ? 202 : 200);
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
