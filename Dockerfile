FROM node:24-slim AS build

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/api-contracts/package.json packages/api-contracts/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN corepack enable && pnpm --version
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build
RUN pnpm --filter @doc-review/server deploy --prod --legacy /prod/server

FROM node:24-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

WORKDIR /app/apps/server

RUN mkdir -p /data && chown node:node /app/apps/server /data

COPY --from=build --chown=node:node /prod/server/node_modules ./node_modules
COPY --from=build --chown=node:node /workspace/apps/server/dist ./dist
COPY --from=build --chown=node:node /workspace/apps/client/dist ../client/dist

USER node

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/health').then((response) => { if (!response.ok) process.exit(1) }).catch(() => process.exit(1))"]

CMD ["node", "dist/main.js"]
