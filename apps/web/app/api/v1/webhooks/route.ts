import { ApiWebhookCreateBodySchema } from '@mynto/shared';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiError, apiJson, readJson, serviceErrorResponse, validationError } from '@/lib/api/http';
import { createWebhook, listWebhooks } from '@/lib/services/webhooks';

export const dynamic = 'force-dynamic';

/** GET /api/v1/webhooks: endpoints of the install (never their secret). */
export async function GET(req: Request): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  try {
    return apiJson({ data: await listWebhooks() });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

/** POST /api/v1/webhooks: creates an endpoint; the signing secret is returned once. */
export async function POST(req: Request): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (body === null) return apiError(400, 'invalid_json', 'Corps JSON invalide ou trop gros.');
  const parsed = ApiWebhookCreateBodySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  try {
    return apiJson(await createWebhook(parsed.data), 201);
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
