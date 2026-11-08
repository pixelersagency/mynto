import { openApiDocument } from '@/lib/api/openapi';
import { publicUrl } from '@/lib/env';

export const dynamic = 'force-dynamic';

/** OpenAPI 3.1 description of the REST API v1 (public, no secret inside). */
export function GET(): Response {
  return Response.json(openApiDocument(publicUrl()), {
    headers: { 'Cache-Control': 'public, max-age=300' },
  });
}
