#!/usr/bin/env bash
set -euo pipefail

echo "[E2E] Protovalidate WKT (Timestamp/Duration)"

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
"${START_CMD[@]}" >/tmp/mock-grpc-wkt.log 2>&1 &
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

ONE_HOUR_AGO_STR=$(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
THREE_HOURS_AGO_STR=$(date -u -d '3 hours ago' +%Y-%m-%dT%H:%M:%SZ)

echo "- Timestamp INVALID (older than 1h)"
set +e
timeout "${TIMEOUT}s" grpcurl -plaintext \
  -import-path protos -proto validation_examples.proto \
  -H "grpc-timeout: ${TIMEOUT}S" \
  -d "{\"ts\":\"$THREE_HOURS_AGO_STR\"}" \
  localhost:$PORT validation.ValidationService/ValidateTimestamp
CODE=$?
set -e
if [ $CODE -eq 0 ]; then echo "Expected failure"; kill $PID; exit 1; fi

echo "- Timestamp VALID (within 1h)"
timeout "${TIMEOUT}s" grpcurl -plaintext \
  -import-path protos -proto validation_examples.proto \
  -H "grpc-timeout: ${TIMEOUT}S" \
  -d "{\"ts\":\"$ONE_HOUR_AGO_STR\"}" \
  localhost:$PORT validation.ValidationService/ValidateTimestamp

echo "- Duration INVALID (>2s)"
set +e
timeout "${TIMEOUT}s" grpcurl -plaintext \
  -import-path protos -proto validation_examples.proto \
  -H "grpc-timeout: ${TIMEOUT}S" \
  -d '{"d":"3s"}' \
  localhost:$PORT validation.ValidationService/ValidateDuration
CODE=$?
set -e
if [ $CODE -eq 0 ]; then echo "Expected failure"; kill $PID; exit 1; fi

echo "- Duration VALID (1s)"
timeout "${TIMEOUT}s" grpcurl -plaintext \
  -import-path protos -proto validation_examples.proto \
  -H "grpc-timeout: ${TIMEOUT}S" \
  -d '{"d":"1s"}' \
  localhost:$PORT validation.ValidationService/ValidateDuration

kill $PID
echo "Done."
