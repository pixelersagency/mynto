import { ApiAuditIdSchema } from '@mynto/shared';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiError, apiJson, serviceErrorResponse } from '@/lib/api/http';
import { getFindings } from '@/lib/services/audits';

export const dynamic = 'force-dynamic';

/** GET /api/v1/audits/{id}/findings: P0 first. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const id = ApiAuditIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, 'not_found', 'Audit introuvable.');
  try {
    return apiJson({ data: await getFindings(id.data) });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
