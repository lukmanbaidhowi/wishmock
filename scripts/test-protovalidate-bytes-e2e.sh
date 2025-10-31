#!/usr/bin/env bash
set -euo pipefail

echo "[E2E] Protovalidate Bytes"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${GRPC_PORT_PLAINTEXT:-50050}"
TIMEOUT="${TIMEOUT:-30}"

VALIDATION_ENABLED=true VALIDATION_SOURCE=protovalidate bun run start >/tmp/mock-grpc-bytes.log 2>&1 &
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
