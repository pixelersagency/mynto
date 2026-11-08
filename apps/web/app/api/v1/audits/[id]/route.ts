import { ApiAuditIdSchema } from '@mynto/shared';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiError, apiJson, serviceErrorResponse } from '@/lib/api/http';
import { deleteAudit, getAudit } from '@/lib/services/audits';

export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ id: string }>;
}

/** GET /api/v1/audits/{id} (an id replaced by a refresh resolves to the current scan). */
export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const id = ApiAuditIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, 'not_found', 'Audit introuvable.');
  try {
    return apiJson(await getAudit(id.data));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

/** DELETE /api/v1/audits/{id}: report, tracking links and media are erased. */
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const id = ApiAuditIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, 'not_found', 'Audit introuvable.');
  try {
    return apiJson({ deleted: await deleteAudit(id.data) });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
