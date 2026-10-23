#!/usr/bin/env bash
# Stages the Vercel deployable into apps/education/.deploy/web/ (gitignored):
#   the built site + api/mcp.mjs (the MCP server as a serverless function) + verified data.
# Usage: deploy/stage.sh            strict: aborts unless the education data checks pass
#        ALLOW_UNVERIFIED=1 deploy/stage.sh   stages anyway; the site shows 'Not verified'
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=../..
OUT=.deploy
LOG="$OUT/check-education.log"
mkdir -p "$OUT"

# Failing check ids from the last run's validation.json (empty if none).
failed_checks() {
  python3 -I -c '
import json
r = json.load(open("'"$ROOT"'/data/clean-education/validation.json"))
print(" ".join(c["id"] for c in r["checks"] if c.get("failures")))
'
}

# Only ship data that passed its ground-truth checks, unless explicitly overridden.
if [ "${ALLOW_UNVERIFIED:-}" = "1" ]; then
  (cd "$ROOT" && pnpm nx run @viz/data:build-education) >"$LOG" 2>&1 || { cat "$LOG"; exit 1; }
  FAILED=$(failed_checks)
  if [ -n "$FAILED" ]; then
    echo "WARNING: education data checks FAILED (report-only): $FAILED" >&2
    echo "WARNING: staging unverified data; the site will show 'Not verified'." >&2
  fi
else
  if ! (cd "$ROOT" && pnpm nx run @viz/data:check-education) >"$LOG" 2>&1; then
    FAILED=$(failed_checks)
    echo "ERROR: education data checks failed: ${FAILED:-unknown (see $LOG)}" >&2
    grep -E '^ +FAIL ' "$LOG" >&2 || true
    echo "Pin the missing PSA files, or re-run with ALLOW_UNVERIFIED=1 to stage unverified data." >&2
    exit 1
  fi
fi

# Keep the Vercel project link across restages.
KEEP="$OUT/.vercel-keep"
rm -rf "$KEEP"
if [ -d "$OUT/web/.vercel" ]; then mv "$OUT/web/.vercel" "$KEEP"; fi
rm -rf "$OUT/web"
mkdir -p "$OUT/web/api" "$OUT/web/data/clean-education"

(cd "$ROOT" && pnpm nx build education >/dev/null)
cp -r dist/. "$OUT/web/"
cp "$ROOT"/data/clean-education/*.csv "$ROOT/data/clean-education/validation.json" "$OUT/web/data/clean-education/"
cp "$ROOT/data/README.md" "$OUT/web/data/"
node deploy/bundle-mcp.mjs "$OUT/web/api/mcp.mjs"
if [ -d "$KEEP" ]; then mv "$KEEP" "$OUT/web/.vercel"; fi

cat > "$OUT/web/vercel.json" <<'JSON'
{
  "rewrites": [{ "source": "/mcp", "destination": "/api/mcp" }],
  "functions": { "api/mcp.mjs": { "includeFiles": "data/**", "maxDuration": 15 } },
  "headers": [
    { "source": "/(.*)", "headers": [
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" }
    ] }
  ]
}
JSON
echo "staged: web $(du -sh "$OUT/web" | cut -f1) (function $(du -h "$OUT/web/api/mcp.mjs" | cut -f1))"
