###########
# Builder #
###########
FROM oven/bun:1.2.20-alpine AS builder
WORKDIR /app

# Install deps (incl. dev) to build
COPY bun.lock package.json ./
RUN bun install

# Copy sources needed for build
COPY tsconfig.json ./
COPY src ./src
COPY frontend ./frontend

# Build server and frontend
RUN bun run build

############
# Runtime  #
############
FROM oven/bun:1.2.20-alpine AS runner
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
COPY protos ./protos
COPY rules ./rules

EXPOSE 50050 50051 3000

# Run the already-built server directly to avoid npm lifecycle prestart
# (which would require devDependencies like TypeScript at runtime).
CMD ["bun", "dist/app.js"]
