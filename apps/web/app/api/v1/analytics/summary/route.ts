import { ApiAnalyticsQuerySchema } from '@mynto/shared';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiJson, serviceErrorResponse, validationError } from '@/lib/api/http';
import { analyticsSummary } from '@/lib/services/audits';

export const dynamic = 'force-dynamic';

/** GET /api/v1/analytics/summary?days=7|30|90 */
export async function GET(req: Request): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  const q = ApiAnalyticsQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return validationError(q.error);
  try {
    return apiJson(await analyticsSummary(q.data.days));
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
