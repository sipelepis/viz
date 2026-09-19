#!/usr/bin/env bash
# Stages the deployables into apps/cancer/.deploy/ (gitignored):
#   web/ -> Vercel: the built site + api/mcp.mjs (the MCP server as a serverless function) + data
#   mcp/ -> Cloud Run source (Dockerfile, server code, verified data), for when GCP is used
# Usage: deploy/stage.sh [CLOUD_RUN_ORIGIN]
#   With an origin, Vercel forwards /mcp to Cloud Run; without, to its own function.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=../..
OUT=.deploy
rm -rf "$OUT/mcp" "$OUT/web"
mkdir -p "$OUT/mcp/apps/cancer/server" "$OUT/mcp/data/clean" "$OUT/web/api" "$OUT/web/data/clean"

# Only ship data that passed its ground-truth checks.
(cd "$ROOT" && pnpm nx run @viz/data:check >/dev/null 2>&1)
(cd "$ROOT" && pnpm nx build cancer >/dev/null)
DATA_FILES=("$ROOT"/data/clean/*.csv "$ROOT/data/clean/validation.json")

# Cloud Run
cp server/data.ts server/mcp.ts server/http.ts "$OUT/mcp/apps/cancer/server/"
cp "${DATA_FILES[@]}" "$OUT/mcp/data/clean/" && cp "$ROOT/data/README.md" "$OUT/mcp/data/"
cp deploy/Dockerfile "$OUT/mcp/"
node -e '
  const d = require("./package.json").dependencies;
  console.log(JSON.stringify({ name: "viz-cancer-mcp", private: true, type: "module",
    dependencies: { "@modelcontextprotocol/sdk": d["@modelcontextprotocol/sdk"], zod: d.zod } }, null, 2));
' > "$OUT/mcp/package.json"

# Vercel
cp -r dist/. "$OUT/web/"
cp "${DATA_FILES[@]}" "$OUT/web/data/clean/" && cp "$ROOT/data/README.md" "$OUT/web/data/"
node deploy/bundle-mcp.mjs "$OUT/web/api/mcp.mjs"
DEST=${1:+$1/mcp}
cat > "$OUT/web/vercel.json" <<JSON
{
  "rewrites": [{ "source": "/mcp", "destination": "${DEST:-/api/mcp}" }],
  "functions": { "api/mcp.mjs": { "includeFiles": "data/**", "maxDuration": 15 } },
  "headers": [
    { "source": "/models/(.*)", "headers": [{ "key": "Cache-Control", "value": "public, max-age=86400" }] },
    { "source": "/(.*)", "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
    ] }
  ]
}
JSON
echo "staged: web $(du -sh "$OUT/web" | cut -f1) (function $(du -h "$OUT/web/api/mcp.mjs" | cut -f1)), mcp $(du -sh "$OUT/mcp" | cut -f1)"
