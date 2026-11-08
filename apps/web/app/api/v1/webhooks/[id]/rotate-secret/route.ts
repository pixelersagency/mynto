import { z } from 'zod';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiError, apiJson, serviceErrorResponse } from '@/lib/api/http';
import { rotateWebhookSecret } from '@/lib/services/webhooks';

export const dynamic = 'force-dynamic';

/** POST /api/v1/webhooks/{id}/rotate-secret: new signing secret, returned once. The old one stops working at once. */
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
    return apiJson(await rotateWebhookSecret(id.data));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
