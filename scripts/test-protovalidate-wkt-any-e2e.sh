#!/usr/bin/env bash
set -euo pipefail

echo "[E2E] Protovalidate WKT (Any)"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${GRPC_PORT_PLAINTEXT:-50050}"

set +e
pkill -f "dist/app.js" >/dev/null 2>&1
set -e

VALIDATION_ENABLED=true VALIDATION_SOURCE=protovalidate bun run start >/tmp/mock-grpc-any.log 2>&1 &
PID=$!
trap 'kill $PID >/dev/null 2>&1 || true' EXIT
echo "Server started (pid=$PID), waiting..."
for i in $(seq 1 40); do
  if curl -fsS "http://localhost:3000/readiness" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "- Any INVALID (not_in)"
set +e
timeout 15s grpcurl -plaintext \
  -d '{"a":{"@type":"type.googleapis.com/google.protobuf.Timestamp","value":"1970-01-01T00:00:00Z"}}' \
  localhost:$PORT validation.ValidationService/ValidateAny
CODE=$?
set -e
if [ $CODE -eq 0 ]; then echo "Expected failure"; kill $PID; exit 1; fi

echo "- Any VALID (allowed type_url)"
timeout 15s grpcurl -plaintext \
  -d '{"a":{"@type":"type.googleapis.com/google.protobuf.Empty","value":{}}}' \
  localhost:$PORT validation.ValidationService/ValidateAny

kill $PID
echo "Done."
