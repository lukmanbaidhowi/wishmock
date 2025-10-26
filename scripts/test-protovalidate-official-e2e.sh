#!/usr/bin/env bash
set -euo pipefail

# E2E tests for official Buf Protovalidate annotations using helloworld.proto

have() { command -v "$1" >/dev/null 2>&1; }

HTTP_PORT="${HTTP_PORT:-3000}"
GRPC_PORT="${GRPC_PORT_PLAINTEXT:-50050}"
TIMEOUT="${TIMEOUT:-30}"

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

export HTTP_PORT
export GRPC_PORT_PLAINTEXT="$GRPC_PORT"
export VALIDATION_ENABLED="true"
export VALIDATION_SOURCE="protovalidate"
export VALIDATION_MODE="per_message"

LOG_FILE="/tmp/validation.protovalidate.out"
RESULTS_FILE="/tmp/validation.protovalidate.results"
rm -f "$LOG_FILE" "$RESULTS_FILE"

echo "=== Protovalidate E2E (official) ===" | tee -a "$RESULTS_FILE"
echo "Runner: $RUNNER | HTTP_PORT: $HTTP_PORT | GRPC_PORT: $GRPC_PORT" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

echo "Starting mock server..." | tee -a "$LOG_FILE"
"${START_CMD[@]}" >>"$LOG_FILE" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID >/dev/null 2>&1 || true' EXIT

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
  echo -e "\nERROR: Timeout waiting for readiness" >&2
  exit 1
fi

TOTAL=0; PASS=0; FAIL=0
run_case() {
  local name="$1" method="$2" data="$3" expect="$4"
  TOTAL=$((TOTAL+1))
  set +e
  out=$(grpcurl -plaintext -d "$data" "localhost:${GRPC_PORT}" "$method" 2>&1)
  code=$?
  set -e
  local is_err=false
  if [[ $code -ne 0 ]] || echo "$out" | grep -q "ERROR:"; then is_err=true; fi
  if [[ "$expect" == invalid && "$is_err" == true ]] || [[ "$expect" == valid && "$is_err" == false ]]; then
    PASS=$((PASS+1)); echo "[PASS] $name" | tee -a "$RESULTS_FILE"
  else
    FAIL=$((FAIL+1)); echo "[FAIL] $name" | tee -a "$RESULTS_FILE"; echo "$out" | head -c 300 | tee -a "$RESULTS_FILE"
  fi
}

# BufValidateString: min_len_field >= 5
run_case "BufValidateString valid" \
  "helloworld.Greeter/BufValidateString" '{"minLenField":"hello"}' valid
run_case "BufValidateString invalid (short)" \
  "helloworld.Greeter/BufValidateString" '{"minLenField":"hey"}' invalid

# BufValidateNumber: const_field == 42, 0 <= range_field <= 100
run_case "BufValidateNumber valid" \
  "helloworld.Greeter/BufValidateNumber" '{"constField":42,"rangeField":10}' valid
run_case "BufValidateNumber invalid const" \
  "helloworld.Greeter/BufValidateNumber" '{"constField":41,"rangeField":10}' invalid
run_case "BufValidateNumber invalid range" \
  "helloworld.Greeter/BufValidateNumber" '{"constField":42,"rangeField":101}' invalid

# BufValidateRepeated: 1 <= items <= 5
run_case "BufValidateRepeated valid" \
  "helloworld.Greeter/BufValidateRepeated" '{"items":["a","b"]}' valid
run_case "BufValidateRepeated too many" \
  "helloworld.Greeter/BufValidateRepeated" '{"items":[1,2,3,4,5,6]}' invalid

echo "TOTAL:$TOTAL PASS:$PASS FAIL:$FAIL" | tee -a "$RESULTS_FILE"
[[ $FAIL -eq 0 ]]
