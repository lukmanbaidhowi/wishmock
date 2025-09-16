#!/usr/bin/env bash
set -euo pipefail

# One-shot tester for README grpcurl examples.
# - Starts the mock server (Bun if available, else Node)
# - Waits for /readiness
# - Executes grpcurl calls (plaintext); optional TLS tests if enabled
# - Prints outputs and exits
#
# Env overrides:
#   HTTP_PORT                 (default: 3000)
#   GRPC_PORT_PLAINTEXT       (default: 50050)
#   TIMEOUT                   (default: 30 seconds)
#   RUNNER                    (bun|node) autodetect by default
#   TLS_TESTS                 (true|false, default: false)
#   GRPC_PORT_TLS             (default: 50051)
#   GRPC_TLS_ENABLED          (auto true if TLS_TESTS=true)
#   GRPC_TLS_CERT_PATH        (default: certs/server.crt)
#   GRPC_TLS_KEY_PATH         (default: certs/server.key)
#   GRPC_TLS_CA_PATH          (default: certs/ca.crt)
#   GRPC_TLS_REQUIRE_CLIENT_CERT (true|false; for mTLS; default off unless set)
#   GRPC_TLS_CLIENT_CERT_PATH (default: certs/client.crt)
#   GRPC_TLS_CLIENT_KEY_PATH  (default: certs/client.key)

have() { command -v "$1" >/dev/null 2>&1; }

HTTP_PORT="${HTTP_PORT:-3000}"
GRPC_PORT="${GRPC_PORT_PLAINTEXT:-50050}"
TIMEOUT="${TIMEOUT:-30}"
TLS_TESTS="${TLS_TESTS:-false}"

if ! have grpcurl; then
  echo "ERROR: grpcurl not found in PATH" >&2
  exit 127
fi
if ! have curl; then
  echo "ERROR: curl not found in PATH" >&2
  exit 127
fi

RUNNER="${RUNNER:-}"
if [[ -z "$RUNNER" ]]; then
  if have bun; then RUNNER="bun"; else RUNNER="node"; fi
fi

if [[ "$RUNNER" == "bun" ]]; then
  START_CMD=(bun run start)
elif [[ "$RUNNER" == "node" ]]; then
  START_CMD=(npm run -s start:node)
else
  echo "ERROR: Unknown RUNNER=$RUNNER (expected bun|node)" >&2
  exit 2
fi

# Export ports for the app
export HTTP_PORT
export GRPC_PORT_PLAINTEXT="$GRPC_PORT"

LOG_FILE="/tmp/wishmock.test.out"
rm -f "$LOG_FILE"

echo "Starting mock server with RUNNER=$RUNNER (HTTP_PORT=$HTTP_PORT, GRPC_PORT=$GRPC_PORT)" | tee -a "$LOG_FILE"

# Ensure third-party protos (google/type, etc.) are present for reflection
NEED_GOOGLE_TYPE=false
for f in google/type/datetime.proto google/type/money.proto google/type/latlng.proto; do
  if [[ ! -f "protos/$f" ]]; then NEED_GOOGLE_TYPE=true; break; fi
done
if [[ "$NEED_GOOGLE_TYPE" == "true" ]]; then
  echo "Third-party protos missing; fetching (scripts/fetch-third-party-protos.sh)" | tee -a "$LOG_FILE"
  if have bun; then
    bun run protos:fetch >>"$LOG_FILE" 2>&1 || bash scripts/fetch-third-party-protos.sh >>"$LOG_FILE" 2>&1 || true
  else
    bash scripts/fetch-third-party-protos.sh >>"$LOG_FILE" 2>&1 || true
  fi
fi

if [[ "$TLS_TESTS" == "true" ]]; then
  export GRPC_TLS_ENABLED="true"
  export GRPC_PORT_TLS="${GRPC_PORT_TLS:-50051}"
  export GRPC_TLS_CERT_PATH="${GRPC_TLS_CERT_PATH:-certs/server.crt}"
  export GRPC_TLS_KEY_PATH="${GRPC_TLS_KEY_PATH:-certs/server.key}"
  export GRPC_TLS_CA_PATH="${GRPC_TLS_CA_PATH:-certs/ca.crt}"
  echo "TLS tests enabled (port=${GRPC_PORT_TLS}, cert=${GRPC_TLS_CERT_PATH})" | tee -a "$LOG_FILE"
fi

"${START_CMD[@]}" >>"$LOG_FILE" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID >/dev/null 2>&1 || true' EXIT
echo "Server PID: $SERVER_PID" | tee -a "$LOG_FILE"

# Wait for readiness
echo -n "Waiting for readiness" | tee -a "$LOG_FILE"
for i in $(seq 1 $((TIMEOUT*2))); do
  if curl -fsS "http://localhost:${HTTP_PORT}/readiness" >/dev/null 2>&1; then
    echo " - OK" | tee -a "$LOG_FILE"
    break
  fi
  sleep 0.5
  echo -n "." | tee -a "$LOG_FILE"
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo -e "\nServer exited early. Logs:" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi
done

if ! curl -fsS "http://localhost:${HTTP_PORT}/readiness" >/dev/null 2>&1; then
  echo -e "\nERROR: Timeout waiting for readiness. Logs:" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

echo "Admin status:"; curl -fsS "http://localhost:${HTTP_PORT}/admin/status" || true; echo

run_call() {
  local name="$1"; shift
  echo "--- TEST: $name"
  set +e
  local output
  output=$("$@" 2>&1)
  local code=$?
  set -e
  echo "exit=$code"
  echo "$output"
  echo
}

# Plaintext README examples
run_call "SayHello plaintext" \
  grpcurl -plaintext -d '{"name":"Tom"}' "localhost:${GRPC_PORT}" helloworld.Greeter/SayHello

run_call "Calendar err-unauth" \
  grpcurl -plaintext -d '{"id":"err-unauth"}' "localhost:${GRPC_PORT}" calendar.Events/GetEvent

run_call "Calendar err-forbidden" \
  grpcurl -plaintext -d '{"id":"err-forbidden"}' "localhost:${GRPC_PORT}" calendar.Events/GetEvent

run_call "Calendar err-unavailable" \
  grpcurl -plaintext -d '{"id":"err-unavailable"}' "localhost:${GRPC_PORT}" calendar.Events/GetEvent

run_call "Calendar err-deadline" \
  grpcurl -plaintext -d '{"id":"err-deadline"}' "localhost:${GRPC_PORT}" calendar.Events/GetEvent

# A success case for Calendar (not in README bullets, but useful)
run_call "Calendar success (next)" \
  grpcurl -plaintext -d '{"id":"next"}' "localhost:${GRPC_PORT}" calendar.Events/GetEvent

# Reflection tests for services in protos/ that import from imports/
run_call "RelService describe (reflection)" \
  grpcurl -plaintext "localhost:${GRPC_PORT}" describe rel.RelService

run_call "AbsService describe (reflection)" \
  grpcurl -plaintext "localhost:${GRPC_PORT}" describe abs.AbsService

run_call "RelService DoRel (reflection)" \
  grpcurl -plaintext -d '{"msg":{"note":"hi"}}' "localhost:${GRPC_PORT}" rel.RelService/DoRel

run_call "AbsService DoAbs (reflection)" \
  grpcurl -plaintext -d '{"msg":{"note":"hi"}}' "localhost:${GRPC_PORT}" abs.AbsService/DoAbs

# Optional TLS tests
if [[ "$TLS_TESTS" == "true" ]]; then
  sleep 0.5
  run_call "TLS hello (server-auth)" \
    grpcurl -d '{"name":"Tom"}' -cacert "${GRPC_TLS_CA_PATH}" "localhost:${GRPC_PORT_TLS}" helloworld.Greeter/SayHello

  if [[ "${GRPC_TLS_REQUIRE_CLIENT_CERT:-}" == "true" ]]; then
    run_call "mTLS hello (client-auth)" \
      grpcurl -d '{"name":"Tom"}' -cacert "${GRPC_TLS_CA_PATH}" \
        -cert "${GRPC_TLS_CLIENT_CERT_PATH:-certs/client.crt}" \
        -key  "${GRPC_TLS_CLIENT_KEY_PATH:-certs/client.key}" \
        "localhost:${GRPC_PORT_TLS}" helloworld.Greeter/SayHello
  fi
fi

echo "Done. Server logs: $LOG_FILE"
