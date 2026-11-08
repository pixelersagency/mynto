import { ApiWebhookDeliveriesQuerySchema } from '@mynto/shared';
import { z } from 'zod';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiError, apiJson, serviceErrorResponse, validationError } from '@/lib/api/http';
import { listDeliveries } from '@/lib/services/webhooks';

export const dynamic = 'force-dynamic';

/** GET /api/v1/webhooks/{id}/deliveries: delivery log (30 days), newest first. */
export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const id = z
    .string()
    .uuid()
    .safeParse((await ctx.params).id);
  if (!id.success) return apiError(404, 'not_found', 'Webhook introuvable.');
  const q = ApiWebhookDeliveriesQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!q.success) return validationError(q.error);
  try {
    return apiJson(await listDeliveries(id.data, q.data));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
