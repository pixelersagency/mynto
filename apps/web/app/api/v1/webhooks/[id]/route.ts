import { ApiWebhookUpdateBodySchema } from '@mynto/shared';
import { z } from 'zod';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiError, apiJson, readJson, serviceErrorResponse, validationError } from '@/lib/api/http';
import { deleteWebhook, getWebhook, updateWebhook } from '@/lib/services/webhooks';

export const dynamic = 'force-dynamic';

interface Ctx {
  params: Promise<{ id: string }>;
}

const IdSchema = z.string().uuid();

export async function GET(req: Request, ctx: Ctx): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const id = IdSchema.safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, 'not_found', 'Webhook introuvable.');
  try {
    return apiJson(await getWebhook(id.data));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

/** PATCH /api/v1/webhooks/{id}: url, events, description, active, legacy_radar_format. */
export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const id = IdSchema.safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, 'not_found', 'Webhook introuvable.');
  const body = await readJson(req);
  if (body === null) return apiError(400, 'invalid_json', 'Corps JSON invalide ou trop gros.');
  const parsed = ApiWebhookUpdateBodySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  try {
    return apiJson(await updateWebhook(id.data, parsed.data));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

/** DELETE /api/v1/webhooks/{id}: the endpoint and its delivery log. */
export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const id = IdSchema.safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, 'not_found', 'Webhook introuvable.');
  try {
    await deleteWebhook(id.data);
    return apiJson({ deleted: true });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
