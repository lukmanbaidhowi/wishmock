#!/usr/bin/env bash
set -euo pipefail

echo "[E2E] Protovalidate WKT (Timestamp/Duration)"

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${GRPC_PORT_PLAINTEXT:-50050}"

VALIDATION_ENABLED=true VALIDATION_SOURCE=protovalidate bun run start >/tmp/mock-grpc-wkt.log 2>&1 &
PID=$!
trap 'kill $PID >/dev/null 2>&1 || true' EXIT
echo "Server started (pid=$PID), waiting..."
for i in $(seq 1 40); do
  if curl -fsS "http://localhost:3000/readiness" >/dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

ONE_HOUR_AGO_STR=$(date -u -d '30 minutes ago' +%Y-%m-%dT%H:%M:%SZ)
THREE_HOURS_AGO_STR=$(date -u -d '3 hours ago' +%Y-%m-%dT%H:%M:%SZ)

echo "- Timestamp INVALID (older than 1h)"
set +e
timeout 15s grpcurl -plaintext \
  -d "{\"ts\":\"$THREE_HOURS_AGO_STR\"}" \
  localhost:$PORT validation.ValidationService/ValidateTimestamp
CODE=$?
set -e
if [ $CODE -eq 0 ]; then echo "Expected failure"; kill $PID; exit 1; fi

echo "- Timestamp VALID (within 1h)"
timeout 15s grpcurl -plaintext \
  -d "{\"ts\":\"$ONE_HOUR_AGO_STR\"}" \
  localhost:$PORT validation.ValidationService/ValidateTimestamp

echo "- Duration INVALID (>2s)"
set +e
timeout 15s grpcurl -plaintext \
  -d '{"d":"3s"}' \
  localhost:$PORT validation.ValidationService/ValidateDuration
CODE=$?
set -e
if [ $CODE -eq 0 ]; then echo "Expected failure"; kill $PID; exit 1; fi

echo "- Duration VALID (1s)"
timeout 15s grpcurl -plaintext \
  -d '{"d":"1s"}' \
  localhost:$PORT validation.ValidationService/ValidateDuration

kill $PID
echo "Done."
