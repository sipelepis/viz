import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleMcpHttp } from './server/mcp.ts';

// Serves the data MCP server at /mcp inside `vite dev` and `vite preview`.
function serveMcp(req: IncomingMessage, res: ServerResponse) {
  handleMcpHttp(req, res).catch((err: unknown) => {
    if (!res.headersSent) res.writeHead(500).end(String(err));
  });
}
const mcp: Plugin = {
  name: 'mcp-http',
  configureServer: (server) => void server.middlewares.use('/mcp', serveMcp),
  configurePreviewServer: (server) => void server.middlewares.use('/mcp', serveMcp),
};

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/cancer',
  server: {
    port: 4200,
    host: 'localhost',
  },
  preview: {
    port: 4300,
    host: 'localhost',
  },
  plugins: [react(), mcp],
  build: {
    outDir: './dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
}));
