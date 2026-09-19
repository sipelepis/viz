// MCP over stdio for Claude Code (registered in the repo's .mcp.json).
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './mcp.ts';

await createMcpServer().connect(new StdioServerTransport());
