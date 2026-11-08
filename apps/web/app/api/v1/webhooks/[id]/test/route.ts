import { z } from 'zod';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiError, apiJson, serviceErrorResponse } from '@/lib/api/http';
import { testWebhook } from '@/lib/services/webhooks';

export const dynamic = 'force-dynamic';

/** POST /api/v1/webhooks/{id}/test: queues a "ping" event (sent within seconds, even if the endpoint is off). */
export async function POST(
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
  try {
    return apiJson(await testWebhook(id.data), 202);
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
