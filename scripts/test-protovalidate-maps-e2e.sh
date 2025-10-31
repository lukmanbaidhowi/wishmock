#!/usr/bin/env bash
set -euo pipefail

echo "[E2E] Protovalidate Maps"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${GRPC_PORT_PLAINTEXT:-50050}"

VALIDATION_ENABLED=true VALIDATION_SOURCE=protovalidate bun run start >/tmp/mock-grpc-maps.log 2>&1 &
PID=$!
trap 'kill $PID >/dev/null 2>&1 || true' EXIT
echo "Server started (pid=$PID), waiting..."
for i in $(seq 1 40); do
  if curl -fsS "http://localhost:3000/readiness" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

echo "- INVALID (empty map)"
set +e
timeout 15s grpcurl -plaintext \
  -d '{"labels":{}}' \
  localhost:$PORT validation.ValidationService/ValidateMap
CODE=$?
set -e
if [ $CODE -eq 0 ]; then echo "Expected failure"; kill $PID; exit 1; fi

echo "- VALID (1-2 pairs, key len>=2, value len<=5)"
timeout 15s grpcurl -plaintext \
  -d '{"labels":{"aa":"short"}}' \
  localhost:$PORT validation.ValidationService/ValidateMap

kill $PID
echo "Done."
