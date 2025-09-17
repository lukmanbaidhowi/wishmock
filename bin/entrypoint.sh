#!/bin/sh
set -e

# Optional MCP server alongside the main app
if [ "${ENABLE_MCP:-false}" = "true" ]; then
  echo "[entrypoint] ENABLE_MCP=true → starting MCP (stdio) in background"
  bun /app/dist/mcp/server.sdk.js &
fi
if [ "${ENABLE_MCP_SSE:-false}" = "true" ]; then
  echo "[entrypoint] ENABLE_MCP_SSE=true → starting MCP (SSE) in background on ${MCP_HTTP_HOST:-0.0.0.0}:${MCP_HTTP_PORT:-9090}"
  bun /app/dist/mcp/server.sse.js &
fi

echo "[entrypoint] starting wishmock gRPC/HTTP server"
exec bun /app/dist/app.js
