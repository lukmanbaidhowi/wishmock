###########
# Builder #
###########
FROM oven/bun:1.3.5-debian AS builder
WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y bash unzip curl

# Install protoc (official pre-compiled binary) to avoid shared lib dependencies in distroless
RUN curl -LO https://github.com/protocolbuffers/protobuf/releases/download/v25.1/protoc-25.1-linux-x86_64.zip \
    && unzip protoc-25.1-linux-x86_64.zip -d /usr/local \
    && rm protoc-25.1-linux-x86_64.zip

COPY bun.lock package.json ./
RUN bun install --frozen-lockfile

COPY tsconfig.json ./
COPY src ./src
COPY frontend ./frontend
COPY types ./types
COPY protos ./protos
COPY scripts ./scripts

RUN bun run build

# Generate descriptors in builder stage (pre-bake)
RUN node ./scripts/generate-descriptors.mjs

# Remove taffydb HIGH vulnerability (CVE-2019-10790)
RUN find ./node_modules -type d -name 'cli' -path '*/protobufjs/cli' -exec rm -rf {} + 2>/dev/null || true

############
# Runtime  #
############
FROM gcr.io/distroless/nodejs24-debian13 as runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Copy assets
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY frontend/index.html ./frontend/index.html
COPY frontend/styles.css ./frontend/styles.css
COPY docs ./docs
COPY --from=builder /app/protos ./protos
COPY rules ./rules

# Copy descriptor generation script for runtime usage
COPY scripts/generate-descriptors.mjs ./scripts/generate-descriptors.mjs

# Copy protoc binary and standard include files from builder
# Note: we use official binary which is statically linked (glibc)
COPY --from=builder /usr/local/bin/protoc /usr/bin/protoc
COPY --from=builder /usr/local/include/google /usr/include/google

# Copy generated descriptors
COPY --from=builder /app/bin/.descriptors.bin ./bin/.descriptors.bin

COPY bin/cluster.mjs ./bin/cluster.mjs
COPY bin/node-entrypoint.mjs ./bin/node-entrypoint.mjs

EXPOSE 50050 50051 50052 4319 9797

ENTRYPOINT ["/nodejs/bin/node", "/app/bin/node-entrypoint.mjs"]
