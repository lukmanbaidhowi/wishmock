#!/usr/bin/env bash
set -euo pipefail

echo "[E2E] Protovalidate Bytes"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${GRPC_PORT_PLAINTEXT:-50050}"
TIMEOUT="${TIMEOUT:-30}"

RUNNER="${RUNNER:-}"
if [[ -z "$RUNNER" ]]; then
  if command -v bun >/dev/null 2>&1; then RUNNER="bun"; else RUNNER="node"; fi
fi
if [[ "$RUNNER" == "bun" ]]; then
  START_CMD=(env VALIDATION_ENABLED=true VALIDATION_SOURCE=protovalidate HTTP_PORT=3000 GRPC_PORT_PLAINTEXT="${PORT}" bun run start)
else
  START_CMD=(env VALIDATION_ENABLED=true VALIDATION_SOURCE=protovalidate HTTP_PORT=3000 GRPC_PORT_PLAINTEXT="${PORT}" npm run -s start:node)
fi
"${START_CMD[@]}" >/tmp/mock-grpc-bytes.log 2>&1 &
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

echo "- Calling with INVALID payload (too short)"
set +e
timeout "${TIMEOUT}s" grpcurl -plaintext \
  -import-path protos -proto validation_examples.proto \
  -H "grpc-timeout: ${TIMEOUT}S" \
  -d '{"payload":"YWI="}' \
  localhost:$PORT validation.ValidationService/ValidateBytes
CODE=$?
set -e
if [ $CODE -eq 0 ]; then
  echo "Expected failure, but call succeeded"; kill $PID; exit 1;
else
  echo "Invalid case failed as expected (code=$CODE)"
fi

echo "- Calling with VALID payload"
timeout "${TIMEOUT}s" grpcurl -plaintext \
  -import-path protos -proto validation_examples.proto \
  -H "grpc-timeout: ${TIMEOUT}S" \
  -d '{"payload":"YWJjZGU="}' \
  localhost:$PORT validation.ValidationService/ValidateBytes

kill $PID
echo "Done."
