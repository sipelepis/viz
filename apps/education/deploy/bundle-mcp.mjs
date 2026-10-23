// Bundles server/vercel.ts (+ MCP SDK and zod) into one ESM file for a Vercel function.
//   node deploy/bundle-mcp.mjs <outfile>
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { build } = await import(require.resolve('rolldown', { paths: [require.resolve('vite')] }));
await build({
  input: new URL('../server/vercel.ts', import.meta.url).pathname,
  platform: 'node',
  output: {
    file: process.argv[2],
    format: 'esm',
    codeSplitting: false,
    // CommonJS deps (ajv) need require(); data lives next to the function (vercel.json includeFiles).
    banner: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);\n" +
      "process.env.VIZ_DATA_DIR ??= process.cwd() + '/data';",
  },
  logLevel: 'warn',
});
