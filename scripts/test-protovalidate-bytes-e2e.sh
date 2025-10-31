#!/usr/bin/env bash
set -euo pipefail

echo "[E2E] Protovalidate Bytes"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${GRPC_PORT_PLAINTEXT:-50050}"

VALIDATION_ENABLED=true VALIDATION_SOURCE=protovalidate bun run start >/tmp/mock-grpc-bytes.log 2>&1 &
PID=$!
trap 'kill $PID >/dev/null 2>&1 || true' EXIT
echo "Server started (pid=$PID), waiting..."
for i in $(seq 1 40); do
  if curl -fsS "http://localhost:3000/readiness" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "- Calling with INVALID payload (too short)"
set +e
timeout 15s grpcurl -plaintext \
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
timeout 15s grpcurl -plaintext \
  -d '{"payload":"YWJjZGU="}' \
  localhost:$PORT validation.ValidationService/ValidateBytes

kill $PID
echo "Done."
