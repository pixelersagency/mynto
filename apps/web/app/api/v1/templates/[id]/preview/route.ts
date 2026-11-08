import { ApiTemplateIdSchema, ApiTemplatePreviewBodySchema } from '@mynto/shared';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiError, apiJson, serviceErrorResponse } from '@/lib/api/http';
import { previewTemplateApi } from '@/lib/services/templates';

export const dynamic = 'force-dynamic';

/** POST /api/v1/templates/{id}/preview: renders a template (stored or draft) as an HTML document. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const id = ApiTemplateIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, 'not_found', 'Modèle introuvable.');
  const body = ApiTemplatePreviewBodySchema.safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!body.success)
    return apiError(400, 'invalid_request', body.error.issues[0]?.message ?? 'Corps invalide.');
  try {
    return apiJson(await previewTemplateApi(id.data, body.data));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
