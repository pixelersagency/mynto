import { ApiCreateAuditBodySchema, ApiListAuditsQuerySchema } from '@mynto/shared';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiError, apiJson, readJson, serviceErrorResponse, validationError } from '@/lib/api/http';
import { createAudit, listAudits } from '@/lib/services/audits';

export const dynamic = 'force-dynamic';

/** GET /api/v1/audits: current audits, newest first, paginated. */
export async function GET(req: Request): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const q = ApiListAuditsQuerySchema.safeParse(params);
  if (!q.success) return validationError(q.error);
  try {
    return apiJson(await listAudits(q.data));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}

/** POST /api/v1/audits: start an audit (202, status "queued"). */
export async function POST(req: Request): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const body = await readJson(req);
  if (body === null) return apiError(400, 'invalid_json', 'Corps JSON invalide ou trop gros.');
  const parsed = ApiCreateAuditBodySchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);
  try {
    return apiJson(await createAudit(parsed.data, 'api'), 202);
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
