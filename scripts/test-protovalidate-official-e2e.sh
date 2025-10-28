#!/usr/bin/env bash
set -euo pipefail

# Minimal E2E smoke for message-level CEL using grpcurl.
# Requires grpcurl and Bun installed. Intended for local runs/CI optional step.

export VALIDATION_ENABLED=true
export VALIDATION_SOURCE=protovalidate
export VALIDATION_MODE=per_message
export VALIDATION_CEL_MESSAGE=experimental

HTTP_PORT=${HTTP_PORT:-3000}
GRPC_PORT_PLAINTEXT=${GRPC_PORT_PLAINTEXT:-50050}

echo "Starting server..."
bun run start >/tmp/wishmock-e2e.log 2>&1 &
PID=$!
cleanup() { kill $PID || true; }; trap cleanup EXIT

# Wait for readiness
for i in {1..30}; do
  if curl -sf "http://localhost:${HTTP_PORT}/liveness" >/dev/null; then
    break
  fi
  sleep 0.3
done

echo "Server ready. Running grpcurl checks..."

# Expect INVALID_ARGUMENT on invalid BufMessageCel (min >= max)
set +e
grpcurl -plaintext -d '{"min_value":10,"max_value":5}' localhost:${GRPC_PORT_PLAINTEXT} helloworld.Greeter/BufMessageCelCheck
RC=$?
set -e
if [ "$RC" -eq 0 ]; then
  echo "Expected non-zero exit for invalid payload" >&2
  exit 1
fi

# Expect success for valid BufMessageCel
grpcurl -plaintext -d '{"min_value":1,"max_value":2}' localhost:${GRPC_PORT_PLAINTEXT} helloworld.Greeter/BufMessageCelCheck >/dev/null

echo "E2E passed"
