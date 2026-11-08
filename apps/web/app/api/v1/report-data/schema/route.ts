import { authenticateApiRequest } from '@/lib/api/auth';
import { apiJson } from '@/lib/api/http';
import { reportDataSchemaApi } from '@/lib/services/templates';

export const dynamic = 'force-dynamic';

/** GET /api/v1/report-data/schema: JSON Schema of the report-data v1 contract + example data. */
export async function GET(req: Request): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;
  return apiJson(reportDataSchemaApi());
}
