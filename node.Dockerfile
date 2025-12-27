###########
# Builder #
###########
FROM oven/bun:1.3.5-alpine AS builder
WORKDIR /app

COPY bun.lock package.json ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY frontend ./frontend
COPY types ./types
COPY protos ./protos
COPY scripts ./scripts

RUN bun run build

############
# Runtime  #
############
FROM node:24.11-alpine AS runner
WORKDIR /app

RUN apk update && apk upgrade --no-cache

ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules

# Remove taffydb HIGH vulnerability (CVE-2019-10790)
RUN find /app/node_modules -type d -name 'cli' -path '*/protobufjs/cli' -exec rm -rf {} + 2>/dev/null || true

COPY --from=builder /app/dist ./dist
RUN mkdir -p frontend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY frontend/index.html ./frontend/index.html
COPY frontend/styles.css ./frontend/styles.css
COPY docs ./docs
COPY protos ./protos
COPY rules ./rules
COPY scripts/generate-descriptor-set.sh ./scripts/generate-descriptor-set.sh
COPY scripts/get-loadable-protos.mjs ./scripts/get-loadable-protos.mjs

RUN apk add --no-cache --upgrade protobuf bash
RUN bash ./scripts/generate-descriptor-set.sh

COPY bin/cluster.mjs ./bin/cluster.mjs
COPY bin/node-entrypoint.sh ./bin/node-entrypoint.sh
RUN chmod +x ./bin/cluster.mjs ./bin/node-entrypoint.sh

EXPOSE 50050 50051 50052 4319 9797

ENTRYPOINT ["/app/bin/node-entrypoint.sh"]
