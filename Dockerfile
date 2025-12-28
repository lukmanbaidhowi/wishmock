###########
# Builder #
###########
FROM oven/bun:1.3.5-alpine AS builder
WORKDIR /app

# Install deps (incl. dev) to build
COPY bun.lock package.json ./
RUN bun install

# Copy sources needed for build
COPY tsconfig.json ./
COPY src ./src
COPY frontend ./frontend
COPY types ./types

# Copy protos and required scripts for descriptor generation
COPY protos ./protos
COPY scripts/generate-descriptors.mjs ./scripts/generate-descriptors.mjs

# Install bash and dependencies for manually installing protoc (for version consistency)
RUN apk add --no-cache bash curl unzip gcompat

# Install protoc (official pre-compiled binary) to ensure version consistency with node.Dockerfile
ARG TARGETARCH
RUN PROTOC_ARCH=$(if [ "$TARGETARCH" = "amd64" ]; then echo "x86_64"; elif [ "$TARGETARCH" = "arm64" ]; then echo "aarch_64"; else echo "x86_64"; fi) \
    && curl -LO "https://github.com/protocolbuffers/protobuf/releases/download/v25.1/protoc-25.1-linux-${PROTOC_ARCH}.zip" \
    && unzip "protoc-25.1-linux-${PROTOC_ARCH}.zip" -d /usr/local \
    && rm "protoc-25.1-linux-${PROTOC_ARCH}.zip"

# Build server, frontend, and generate descriptors
RUN bun run build && bun run descriptors:generate

############
# Runtime  #
############
FROM oven/bun:1.3.5-alpine AS runner
WORKDIR /app

# Set environment for container networking
ENV NODE_ENV=production
ENV HOST=0.0.0.0

# Reuse dependencies from builder to avoid network installs in runtime stage
COPY --from=builder /app/node_modules ./node_modules
COPY package.json bun.lock ./

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
# Only copy scripts needed for hot-reload descriptor generation
COPY scripts/generate-descriptors.mjs ./scripts/generate-descriptors.mjs

# Copy pre-generated descriptor set from builder
COPY --from=builder /app/bin/.descriptors.bin ./bin/.descriptors.bin

# Install bash and gcompat for running official protoc binary
RUN apk add --no-cache bash gcompat

# Copy protoc binary and standard include files from builder
COPY --from=builder /usr/local/bin/protoc /usr/bin/protoc
COPY --from=builder /usr/local/include/google /usr/include/google

# Entrypoint to optionally run the MCP server via ENABLE_MCP=true
COPY bin/entrypoint.sh ./bin/entrypoint.sh
RUN chmod +x ./bin/entrypoint.sh

EXPOSE 50050 50051 50052 4319 9797

# Use entrypoint to optionally launch MCP server before main app
ENTRYPOINT ["/app/bin/entrypoint.sh"]
