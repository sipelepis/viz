// The app reads all of its data through the MCP server at /mcp (see server/mcp.ts).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

let client: Promise<Client> | undefined;

function connect() {
  client ??= (async () => {
    const c = new Client({ name: 'education-app', version: '0.1.0' });
    // The stateless server answers the SDK's optional GET (SSE probe) with 405; answer it locally so the console stays clean.
    const fetchNoProbe: typeof fetch = (url, init) =>
      init?.method === 'GET' ? Promise.resolve(new Response(null, { status: 405 })) : fetch(url, init);
    await c.connect(new StreamableHTTPClientTransport(new URL('/mcp', location.origin), { fetch: fetchNoProbe }));
    return c;
  })().catch((err: unknown) => {
    client = undefined; // let the next call retry
    throw err;
  });
  return client;
}

export async function callTool<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await (await connect()).callTool({ name, arguments: args });
  const text = (res.content as { type: string; text?: string }[])[0]?.text ?? '';
  if (res.isError) throw new Error(text);
  return JSON.parse(text) as T;
}

export type ToolInfo = { name: string; title?: string; description?: string };

export async function listTools(): Promise<ToolInfo[]> {
  return (await (await connect()).listTools()).tools;
}
