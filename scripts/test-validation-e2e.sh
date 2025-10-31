#!/usr/bin/env bash
set -euo pipefail

# E2E Validation Testing Script
# Tests all validation rules for proto messages with grpcurl
# Outputs detailed pass/fail results with comparison to expected outcomes

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
export VALIDATION_SOURCE="auto"
export VALIDATION_MODE="per_message"

LOG_FILE="/tmp/validation.test.out"
RESULTS_FILE="/tmp/validation.test.results"
rm -f "$LOG_FILE" "$RESULTS_FILE"

echo "=== Validation E2E Testing ===" | tee -a "$RESULTS_FILE"
echo "Runner: $RUNNER | HTTP_PORT: $HTTP_PORT | GRPC_PORT: $GRPC_PORT" | tee -a "$RESULTS_FILE"
echo "VALIDATION_ENABLED: $VALIDATION_ENABLED" | tee -a "$RESULTS_FILE"
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

echo "Admin status:" | tee -a "$RESULTS_FILE"
curl -fsS "http://localhost:${HTTP_PORT}/admin/status" | tee -a "$RESULTS_FILE" || true
echo "" | tee -a "$RESULTS_FILE"

# Test counter
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

run_validation_test() {
  local test_name="$1"
  local service_method="$2"
  local json_data="$3"
  local expect_status="$4"  # "valid" or "invalid"
  local description="${5:-}"
  
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  
  echo "---" | tee -a "$RESULTS_FILE"
  echo "TEST $TOTAL_TESTS: $test_name" | tee -a "$RESULTS_FILE"
  if [[ -n "$description" ]]; then
    echo "Description: $description" | tee -a "$RESULTS_FILE"
  fi
  echo "Expected: $expect_status" | tee -a "$RESULTS_FILE"
  echo "Request: $json_data" | tee -a "$RESULTS_FILE"
  
  set +e
  local output
  output=$(timeout "${TIMEOUT}s" grpcurl -plaintext -d "$json_data" "localhost:${GRPC_PORT}" "$service_method" 2>&1)
  local exit_code=$?
  set -e
  
  # Determine if response is error (code 67 = InvalidArgument, 16 = Unauthenticated, etc.)
  # Exit code 0 = success, non-zero = error
  # For grpcurl: exit code 1 means error status, but output contains the status details
  local is_error=false
  if [[ $exit_code -ne 0 ]] || echo "$output" | grep -q "ERROR:"; then
    is_error=true
  fi
  
  if [[ "$expect_status" == "invalid" ]] && [[ "$is_error" == "true" ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "Result: ✓ PASS (correctly rejected)" | tee -a "$RESULTS_FILE"
  elif [[ "$expect_status" == "valid" ]] && [[ "$is_error" == "false" ]]; then
    PASSED_TESTS=$((PASSED_TESTS + 1))
    echo "Result: ✓ PASS (correctly accepted)" | tee -a "$RESULTS_FILE"
  else
    FAILED_TESTS=$((FAILED_TESTS + 1))
    echo "Result: ✗ FAIL (unexpected outcome)" | tee -a "$RESULTS_FILE"
  fi
  
  echo "Exit Code: $exit_code" | tee -a "$RESULTS_FILE"
  echo "Output (first 500 chars):" | tee -a "$RESULTS_FILE"
  echo "${output:0:500}" | tee -a "$RESULTS_FILE"
  echo "" | tee -a "$RESULTS_FILE"
}

# ============================================================
# STRING VALIDATION TESTS (min_len, max_len, pattern, email)
# ============================================================

echo ""
echo "========== STRING VALIDATION TESTS ==========" | tee -a "$RESULTS_FILE"
echo ""

run_validation_test \
  "HelloRequest: valid name (min_len=3)" \
  "helloworld.Greeter/SayHello" \
  '{"name":"Tom"}' \
  "valid" \
  "String with length >= 3 should pass"

run_validation_test \
  "HelloRequest: name too short (min_len=3)" \
  "helloworld.Greeter/SayHello" \
  '{"name":"ab"}' \
  "invalid" \
  "String with length < 3 should fail min_len constraint"

run_validation_test \
  "HelloRequest: valid name (pattern check)" \
  "helloworld.Greeter/SayHello" \
  '{"name":"John-Doe_123"}' \
  "valid" \
  "Name with alphanumeric, dash, underscore should pass"

run_validation_test \
  "HelloRequest: name with special chars (pattern)" \
  "helloworld.Greeter/SayHello" \
  '{"name":"John@Doe"}' \
  "invalid" \
  "Name with @ should fail pattern constraint"

run_validation_test \
  "HelloRequest: name too long (max_len=50)" \
  "helloworld.Greeter/SayHello" \
  '{"name":"This_is_a_very_long_name_that_exceeds_the_maximum_length_allowed"}' \
  "invalid" \
  "String with length > 50 should fail max_len constraint"

# ============================================================
# INT32 VALIDATION TESTS (gte, lte)
# ============================================================

echo ""
echo "========== INT32 VALIDATION TESTS ==========" | tee -a "$RESULTS_FILE"
echo ""

run_validation_test \
  "HelloRequest: valid age (gte=0, lte=150)" \
  "helloworld.Greeter/SayHello" \
  '{"name":"Tom","age":25}' \
  "valid" \
  "Age between 0-150 should pass"

run_validation_test \
  "HelloRequest: age too low (gte=0)" \
  "helloworld.Greeter/SayHello" \
  '{"name":"Tom","age":-1}' \
  "invalid" \
  "Age less than 0 should fail gte constraint"

run_validation_test \
  "HelloRequest: age too high (lte=150)" \
  "helloworld.Greeter/SayHello" \
  '{"name":"Tom","age":151}' \
  "invalid" \
  "Age greater than 150 should fail lte constraint"

# ============================================================
# EMAIL VALIDATION TESTS
# ============================================================

echo ""
echo "========== EMAIL VALIDATION TESTS ==========" | tee -a "$RESULTS_FILE"
echo ""

run_validation_test \
  "HelloRequest: valid email format" \
  "helloworld.Greeter/SayHello" \
  '{"name":"Tom","email":"user@example.com"}' \
  "valid" \
  "Valid email format should pass"

run_validation_test \
  "HelloRequest: invalid email (no @)" \
  "helloworld.Greeter/SayHello" \
  '{"name":"Tom","email":"invalid-email"}' \
  "invalid" \
  "Email without @ should fail validation"

# ============================================================
# STREAMING VALIDATION TESTS
# ============================================================

echo ""
echo "========== STREAMING VALIDATION TESTS ==========" | tee -a "$RESULTS_FILE"
echo ""

run_validation_test \
  "UploadHello: valid stream items" \
  "helloworld.Greeter/UploadHello" \
  '{"name":"Alice"}' \
  "valid" \
  "Valid streaming items should pass"

# ============================================================
# SUMMARY
# ============================================================

echo "" | tee -a "$RESULTS_FILE"
echo "========== TEST SUMMARY ==========" | tee -a "$RESULTS_FILE"
echo "Total Tests: $TOTAL_TESTS" | tee -a "$RESULTS_FILE"
echo "Passed: $PASSED_TESTS ✓" | tee -a "$RESULTS_FILE"
echo "Failed: $FAILED_TESTS ✗" | tee -a "$RESULTS_FILE"

if [[ $FAILED_TESTS -eq 0 ]]; then
  echo "Status: ALL TESTS PASSED 🎉" | tee -a "$RESULTS_FILE"
else
  echo "Status: SOME TESTS FAILED" | tee -a "$RESULTS_FILE"
fi

echo "" | tee -a "$RESULTS_FILE"
echo "Full logs: $LOG_FILE" | tee -a "$RESULTS_FILE"
echo "Results: $RESULTS_FILE" | tee -a "$RESULTS_FILE"

if [[ $FAILED_TESTS -gt 0 ]]; then
  exit 1
fi
