import { ApiTemplateIdSchema, ApiTemplateSaveBodySchema } from '@mynto/shared';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiError, apiJson, serviceErrorResponse } from '@/lib/api/http';
import { getTemplateApi, saveTemplateApi } from '@/lib/services/templates';

export const dynamic = 'force-dynamic';

/** GET /api/v1/templates/{id}: manifest, files and settings of a template. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const id = ApiTemplateIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, 'not_found', 'Modèle introuvable.');
  try {
    return apiJson(await getTemplateApi(id.data));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

/** PUT /api/v1/templates/{id}: creates or replaces a template, only when it passes the check. */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const id = ApiTemplateIdSchema.safeParse((await ctx.params).id);
  if (!id.success) return apiError(400, 'invalid_request', 'Identifiant de modèle invalide.');
  const body = ApiTemplateSaveBodySchema.safeParse(await req.json().catch(() => null));
  if (!body.success)
    return apiError(400, 'invalid_request', body.error.issues[0]?.message ?? 'Corps invalide.');
  try {
    const res = await saveTemplateApi(id.data, body.data);
    return apiJson(res, res.saved ? (res.created ? 201 : 200) : 422);
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
