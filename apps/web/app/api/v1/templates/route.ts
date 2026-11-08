import { authenticateApiRequest } from '@/lib/api/auth';
import { apiJson, serviceErrorResponse } from '@/lib/api/http';
import { listTemplatesApi } from '@/lib/services/templates';

export const dynamic = 'force-dynamic';

/** GET /api/v1/templates: report templates of the install. */
export async function GET(req: Request): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  try {
    return apiJson({ data: await listTemplatesApi() });
  } catch (err) {
    return serviceErrorResponse(err);
  }
}
