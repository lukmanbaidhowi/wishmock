# CI test image for wishmock
# Uses Bun to install deps and run tests
FROM oven/bun:1.2.20 AS base

WORKDIR /app

# Install dependencies first (leverage Docker layer cache)
COPY bun.lock package.json ./
RUN bun install --frozen-lockfile

# Copy the rest of the source
COPY . .

# Run tests during build so the build fails on test failures
RUN bun test
