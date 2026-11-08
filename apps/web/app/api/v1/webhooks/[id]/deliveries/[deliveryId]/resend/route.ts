import { z } from 'zod';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiError, apiJson, serviceErrorResponse } from '@/lib/api/http';
import { resendDelivery } from '@/lib/services/webhooks';

export const dynamic = 'force-dynamic';

/** POST /api/v1/webhooks/{id}/deliveries/{deliveryId}/resend: same event, same body, new delivery. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; deliveryId: string }> },
): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const p = await ctx.params;
  const ids = z.object({ id: z.string().uuid(), deliveryId: z.string().uuid() }).safeParse(p);
  if (!ids.success) return apiError(404, 'not_found', 'Livraison introuvable.');
  try {
    return apiJson(await resendDelivery(ids.data.id, ids.data.deliveryId), 202);
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
