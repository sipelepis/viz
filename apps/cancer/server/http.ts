// Standalone HTTP host for the MCP server (Cloud Run). The Vercel site rewrites /mcp to it, so
// browsers reach it same-origin; other MCP clients can call it directly.
//   node server/http.ts   (PORT defaults to 8080)
import { createServer } from 'node:http';
import { handleMcpHttp } from './mcp.ts';
import { tables } from './data.ts';

tables(); // fail fast at boot if the data files are missing

const server = createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];
  if (path === '/mcp') {
    handleMcpHttp(req, res).catch((err: unknown) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500).end('internal error');
    });
  } else if (path === '/healthz' || path === '/') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('viz-cancer MCP server: POST /mcp\n');
  } else {
    res.writeHead(404).end();
  }
});
server.requestTimeout = 30_000;
server.listen(Number(process.env.PORT ?? 8080), () => console.log(`MCP server listening on ${process.env.PORT ?? 8080}`));
