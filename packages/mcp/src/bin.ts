import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { createHttpBackend } from './http-backend.js';
import { createMyntoServer } from './server.js';

/**
 * mynto-mcp: stdio MCP server for Claude Desktop / Claude Code, talking to a
 * mynto install over its REST API.
 *
 *   MYNTO_URL=https://audit.agence.fr MYNTO_API_KEY=myn_live_... mynto-mcp
 *
 * stdout carries the MCP protocol: diagnostics go to stderr only.
 */
async function main(): Promise<void> {
  const baseUrl = process.env.MYNTO_URL;
  const apiKey = process.env.MYNTO_API_KEY;
  if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
    process.stderr.write('mynto-mcp: set MYNTO_URL (e.g. https://audit.example.com)\n');
    process.exit(1);
  }
  if (!apiKey?.startsWith('myn_live_')) {
    process.stderr.write('mynto-mcp: set MYNTO_API_KEY (Réglages > API et MCP)\n');
    process.exit(1);
  }
  const server = createMyntoServer(createHttpBackend({ baseUrl, apiKey }));
  await server.connect(new StdioServerTransport());
  process.stderr.write(`mynto-mcp: connected to ${new URL(baseUrl).host}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`mynto-mcp: ${err instanceof Error ? err.message : 'fatal error'}\n`);
  process.exit(1);
});
