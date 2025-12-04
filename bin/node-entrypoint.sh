#!/bin/sh
set -e

# Node runtime entrypoint with optional MCP sidecars and cluster mode.
# Env flags:
#   ENABLE_MCP=true            # start stdio MCP server in background
#   ENABLE_MCP_SSE=true        # start HTTP SSE MCP server in background
#   START_CLUSTER=true         # run Node cluster (bin/cluster.mjs)
#   CLUSTER_WORKERS=<n>        # number of workers (used by cluster.mjs)

if [ "${ENABLE_MCP:-false}" = "true" ]; then
  echo "[node-entrypoint] ENABLE_MCP=true → starting MCP (stdio) in background"
  node /app/dist/mcp/server.sdk.js &
fi

if [ "${ENABLE_MCP_SSE:-false}" = "true" ]; then
  echo "[node-entrypoint] ENABLE_MCP_SSE=true → starting MCP (SSE) in background on ${MCP_HTTP_HOST:-0.0.0.0}:${MCP_HTTP_PORT:-9797}"
  node /app/dist/mcp/server.sse.js &
fi

if [ "${START_CLUSTER:-false}" = "true" ]; then
  echo "[node-entrypoint] starting wishmock in cluster mode (workers=${CLUSTER_WORKERS:-auto})"
  exec node /app/bin/cluster.mjs
else
  echo "[node-entrypoint] starting wishmock gRPC/HTTP server (single process)"
  exec node /app/dist/app.js
fi
