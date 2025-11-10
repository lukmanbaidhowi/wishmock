#!/usr/bin/env bash
set -euo pipefail

echo "[E2E] Protovalidate WKT (Any)"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${GRPC_PORT_PLAINTEXT:-50050}"
TIMEOUT="${TIMEOUT:-30}"

RUNNER="${RUNNER:-}"
if [[ -z "$RUNNER" ]]; then
  if command -v bun >/dev/null 2>&1; then RUNNER="bun"; else RUNNER="node"; fi
fi
if [[ "$RUNNER" == "bun" ]]; then
  START_CMD=(env VALIDATION_ENABLED=true VALIDATION_SOURCE=protovalidate bun run start)
else
  START_CMD=(env VALIDATION_ENABLED=true VALIDATION_SOURCE=protovalidate npm run -s start:node)
fi
"${START_CMD[@]}" >/tmp/mock-grpc-any.log 2>&1 &
PID=$!
trap 'kill $PID >/dev/null 2>&1 || true' EXIT
echo "Server started (pid=$PID), waiting..."
# Wait up to TIMEOUT seconds for readiness (poll every 0.5s)
for i in $(seq 1 $((TIMEOUT*2))); do
  if curl --max-time 2 -fsS "http://localhost:3000/readiness" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "- Any INVALID (not_in)"
set +e
timeout "${TIMEOUT}s" grpcurl -plaintext \
  -import-path protos -proto validation_examples.proto \
  -H "grpc-timeout: ${TIMEOUT}S" \
  -d '{"a":{"@type":"type.googleapis.com/google.protobuf.Timestamp","value":"1970-01-01T00:00:00Z"}}' \
  localhost:$PORT validation.ValidationService/ValidateAny
CODE=$?
set -e
if [ $CODE -eq 0 ]; then echo "Expected failure"; kill $PID; exit 1; fi

echo "- Any VALID (allowed type_url)"
timeout "${TIMEOUT}s" grpcurl -plaintext \
  -import-path protos -proto validation_examples.proto \
  -H "grpc-timeout: ${TIMEOUT}S" \
  -d '{"a":{"@type":"type.googleapis.com/google.protobuf.Empty","value":{}}}' \
  localhost:$PORT validation.ValidationService/ValidateAny

kill $PID
echo "Done."
