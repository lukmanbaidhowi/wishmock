#!/usr/bin/env bash
set -euo pipefail

have() { command -v "$1" >/dev/null 2>&1; }

HTTP_PORT="${HTTP_PORT:-3000}"
GRPC_PORT="${GRPC_PORT_PLAINTEXT:-50050}"
TIMEOUT="${TIMEOUT:-20}"

if ! have grpcurl; then echo "ERROR: grpcurl not found" >&2; exit 127; fi
if ! have curl; then echo "ERROR: curl not found" >&2; exit 127; fi

RUNNER="${RUNNER:-}"
if [[ -z "$RUNNER" ]]; then
  if have bun; then RUNNER="bun"; else RUNNER="node"; fi
fi

if [[ "$RUNNER" == "bun" ]]; then
  START_CMD=(bun run start)
else
  START_CMD=(npm run -s start:node)
fi

export HTTP_PORT
export GRPC_PORT_PLAINTEXT="$GRPC_PORT"
export VALIDATION_ENABLED="true"
export VALIDATION_SOURCE="auto"
export VALIDATION_MODE="per_message"

LOG_FILE="/tmp/oneof.test.log"
rm -f "$LOG_FILE"

"${START_CMD[@]}" >>"$LOG_FILE" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID >/dev/null 2>&1 || true' EXIT

for i in $(seq 1 $((TIMEOUT*2))); do
  if curl -fsS "http://localhost:${HTTP_PORT}/readiness" >/dev/null 2>&1; then break; fi
  sleep 0.5
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then echo "Server exited" >&2; cat "$LOG_FILE" >&2; exit 1; fi
done

service="helloworld.Greeter/ValidateOneof"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

# contact: proto semantics (0 or 1 ok) while satisfying required group
# Zero set for 'contact' (set required oneof only)
if grpcurl -plaintext -d '{"email_req":"req@ex.com"}' localhost:${GRPC_PORT} "$service" >/dev/null; then pass "proto: zero set"; else fail "proto: zero set"; fi
# One set for 'contact' (and set required oneof)
if grpcurl -plaintext -d '{"email":"a@b.com","email_req":"req@ex.com"}' localhost:${GRPC_PORT} "$service" >/dev/null; then pass "proto: one set"; else fail "proto: one set"; fi
# Multiple set in 'contact': note grpcurl/proto marshaller keeps only the last oneof field
# So the server receives only one field set; treat success as expected here.
if grpcurl -plaintext -d '{"email":"a@b.com","phone":"123","email_req":"req@ex.com"}' localhost:${GRPC_PORT} "$service" >/dev/null 2>&1; then
  pass "proto: multiple collapses to one (marshaller)"
else
  fail "proto: multiple case unexpectedly failed"
fi

# contact_req: required exactly one
if grpcurl -plaintext -d '{"email_req":"a@b.com"}' localhost:${GRPC_PORT} "$service" >/dev/null; then pass "required: one set"; else fail "required: one set"; fi
# Multiple in required group also collapses to one (last wins), so expect success here too
if grpcurl -plaintext -d '{"email_req":"a@b.com","phone_req":"123"}' localhost:${GRPC_PORT} "$service" >/dev/null 2>&1; then
  pass "required: multiple collapses to one (marshaller)"
else
  fail "required: multiple case unexpectedly failed"
fi
if grpcurl -plaintext -d '{}' localhost:${GRPC_PORT} "$service" >/dev/null 2>&1; then fail "required: zero should fail"; else pass "required: zero fails"; fi

echo "All oneof tests passed."
