# MCP server for Cloud Run. Built from a staged directory (see deploy/stage.sh) that mirrors the
# repo layout the server expects: apps/cancer/server + data/clean + data/README.md.
FROM node:24-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY apps ./apps
COPY data ./data
ENV NODE_ENV=production
USER node
CMD ["node", "apps/cancer/server/http.ts"]
