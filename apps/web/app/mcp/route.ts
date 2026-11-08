import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMyntoServer } from '@mynto/mcp';

import { authenticateApiRequest } from '@/lib/api/auth';
import { apiError } from '@/lib/api/http';
import { logger } from '@/lib/logger';
import { serviceBackend } from '@/lib/services/mcp-backend';

export const dynamic = 'force-dynamic';

/**
 * MCP server, Streamable HTTP transport, stateless mode: every POST carries
 * one JSON-RPC exchange and is authenticated with an API key (Bearer), like
 * /api/v1. No session, no server-sent stream (GET and DELETE answer 405).
 * Tools are the same as the stdio server, backed by the service layer.
 */
export async function POST(req: Request): Promise<Response> {
  const auth = await authenticateApiRequest(req);
  if (!auth.ok) return auth.response;

  const server = createMyntoServer(serviceBackend('mcp'));
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (err) {
    logger.error({ err: (err as Error).name }, 'mcp_request_failed');
    return apiError(500, 'internal', 'Erreur interne du serveur MCP.');
  }
}

function notAllowed(): Response {
  return apiError(405, 'method_not_allowed', 'Serveur MCP sans état : utilise POST.', {
    Allow: 'POST',
  });
}

export function GET(): Response {
  return notAllowed();
}

export function DELETE(): Response {
  return notAllowed();
}
