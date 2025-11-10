###########
# Builder #
###########
FROM oven/bun:1.2.20-alpine AS builder
WORKDIR /app

# Install deps (incl. dev) to build
# Copy lock file first for better cache
COPY bun.lock package.json ./
RUN bun install --frozen-lockfile

# Copy sources needed for build
COPY tsconfig.json ./
COPY src ./src
COPY frontend ./frontend
COPY types ./types

# Copy protos and required script for descriptor generation
COPY protos ./protos
COPY scripts ./scripts

# Build server and frontend
RUN bun run build

# Install protoc in builder and pre-generate descriptor set for reflection
RUN apk add --no-cache bash protobuf
RUN bash ./scripts/generate-descriptor-set.sh

############
# Runtime  #
############
FROM node:20-alpine AS runner
WORKDIR /app

# Set environment for container networking
ENV NODE_ENV=production
ENV HOST=0.0.0.0

# Copy node_modules from builder stage
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# Bring built artifacts and runtime assets
COPY --from=builder /app/dist ./dist
# Minimal frontend assets only
RUN mkdir -p frontend/dist
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY frontend/index.html ./frontend/index.html
COPY frontend/styles.css ./frontend/styles.css
COPY docs ./docs
COPY protos ./protos
COPY rules ./rules
# Only copy script needed for hot-reload descriptor generation
COPY scripts/generate-descriptor-set.sh ./scripts/generate-descriptor-set.sh
COPY scripts/get-loadable-protos.mjs ./scripts/get-loadable-protos.mjs

# Include pre-generated descriptor set from builder; runtime can still hot-regenerate if protos change
COPY --from=builder /app/bin/.descriptors.bin ./bin/.descriptors.bin

# Install protoc and bash for hot-reload descriptor regeneration
RUN apk add --no-cache protobuf bash

# Copy cluster and node entrypoint scripts
COPY bin/cluster.mjs ./bin/cluster.mjs
COPY bin/node-entrypoint.sh ./bin/node-entrypoint.sh
RUN chmod +x ./bin/cluster.mjs ./bin/node-entrypoint.sh

EXPOSE 50050 50051 3000 9090

# Use node entrypoint for cluster support
ENTRYPOINT ["/app/bin/node-entrypoint.sh"]
