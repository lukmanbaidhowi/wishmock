#!/usr/bin/env bash
set -euo pipefail

# Minimal E2E smoke for message-level CEL using grpcurl.
# Requires grpcurl and Bun installed. Intended for local runs/CI optional step.

export VALIDATION_ENABLED=true
export VALIDATION_SOURCE=protovalidate
export VALIDATION_MODE=per_message
export VALIDATION_CEL_MESSAGE=experimental

HTTP_PORT=${HTTP_PORT:-3010}
GRPC_PORT_PLAINTEXT=${GRPC_PORT_PLAINTEXT:-50060}
TIMEOUT=${TIMEOUT:-30}

RUNNER="${RUNNER:-}"
if [[ -z "$RUNNER" ]]; then
  if command -v bun >/dev/null 2>&1; then RUNNER="bun"; else RUNNER="node"; fi
fi
if [[ "$RUNNER" == "bun" ]]; then
  START_CMD=(env VALIDATION_ENABLED=true VALIDATION_SOURCE=protovalidate VALIDATION_MODE=per_message VALIDATION_CEL_MESSAGE=experimental bun run start)
else
  START_CMD=(env VALIDATION_ENABLED=true VALIDATION_SOURCE=protovalidate VALIDATION_MODE=per_message VALIDATION_CEL_MESSAGE=experimental npm run -s start:node)
fi

echo "Starting server with $RUNNER..."
"${START_CMD[@]}" >/tmp/wishmock-e2e.log 2>&1 &
PID=$!
cleanup() { kill $PID >/dev/null 2>&1 || true; }; trap cleanup EXIT

# Wait for readiness (bounded by TIMEOUT)
for i in $(seq 1 $((TIMEOUT*3))); do
  if curl --max-time 2 -sf "http://localhost:${HTTP_PORT}/liveness" >/dev/null; then
    break
  fi
  sleep 0.3
done

echo "Server ready. Running grpcurl checks..."

# Expect INVALID_ARGUMENT on invalid BufMessageCel (min >= max)
set +e
timeout "${TIMEOUT}s" grpcurl -plaintext -d '{"min_value":10,"max_value":5}' localhost:${GRPC_PORT_PLAINTEXT} helloworld.Greeter/BufMessageCelCheck
RC=$?
set -e
if [ "$RC" -eq 0 ]; then
  echo "Expected non-zero exit for invalid payload" >&2
  exit 1
fi

# Expect success for valid BufMessageCel
timeout "${TIMEOUT}s" grpcurl -plaintext -d '{"min_value":1,"max_value":2}' localhost:${GRPC_PORT_PLAINTEXT} helloworld.Greeter/BufMessageCelCheck >/dev/null

echo "E2E passed"
