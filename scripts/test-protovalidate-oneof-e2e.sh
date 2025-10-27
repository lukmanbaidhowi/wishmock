#!/usr/bin/env bash
set -euo pipefail

# E2E smoke test for message-level oneof (baseline parsing behavior).
# Requires grpcurl and Bun installed.

export VALIDATION_ENABLED=true
export VALIDATION_SOURCE=protovalidate
export VALIDATION_MODE=per_message

HTTP_PORT=${HTTP_PORT:-3000}
GRPC_PORT_PLAINTEXT=${GRPC_PORT_PLAINTEXT:-50050}

echo "Starting server..."
bun run start >/tmp/wishmock-e2e-oneof.log 2>&1 &
PID=$!
cleanup() { kill $PID || true; }; trap cleanup EXIT

# Wait for readiness
for i in {1..40}; do
  if curl -sf "http://localhost:${HTTP_PORT}/liveness" >/dev/null; then
    break
  fi
  sleep 0.25
done

echo "Server ready. Running grpcurl checks for BufMessageOneofCheck..."

# Invalid: empty payload should fail when required=true (flattened behavior)
set +e
grpcurl -plaintext -d '{}' localhost:${GRPC_PORT_PLAINTEXT} helloworld.Greeter/BufMessageOneofCheck >/dev/null
RC=$?
set -e
if [ "$RC" -eq 0 ]; then
  echo "Expected non-zero exit for empty payload on required oneof" >&2
  exit 1
fi

# Valid: provide the visible field (typically 'd' due to flattening)
grpcurl -plaintext -d '{"d":"ok"}' localhost:${GRPC_PORT_PLAINTEXT} helloworld.Greeter/BufMessageOneofCheck >/dev/null

echo "E2E (oneof baseline) passed"

