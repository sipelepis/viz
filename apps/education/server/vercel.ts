// Vercel serverless entry for the MCP server (bundled to api/mcp.js by deploy/stage.sh).
// Vercel parses JSON bodies itself (req.body), so the parsed body is passed through.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleMcpHttp } from './mcp.ts';

export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST' }).end();
    return;
  }
  await handleMcpHttp(req, res, req.body);
}
