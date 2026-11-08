import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerMyntoTools, type MyntoBackend } from './tools.js';

export const SERVER_INFO = { name: 'mynto', version: '0.1.0' } as const;

const INSTRUCTIONS =
  'Tools of a self-hosted mynto install (website audits for agencies). ' +
  'create_audit starts a scan that takes a few minutes: poll get_audit. ' +
  'Send the tracking_url to prospects; report_url is for the agency.';

/** A fresh MCP server with every mynto tool bound to `backend`. */
export function createMyntoServer(backend: MyntoBackend): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });
  registerMyntoTools(server, backend);
  return server;
}
