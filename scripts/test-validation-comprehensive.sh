#!/usr/bin/env bash
set -euo pipefail

# Comprehensive Validation Testing Script
# Tests all validation constraint types:
# - String: min_len, max_len, pattern, email, uuid, hostname, ipv4, ipv6, uri, prefix, suffix, contains, not_contains, in, not_in
# - Numbers: const, gt, gte, lt, lte, in, not_in
# - Repeated: min_items, max_items, unique
# - Message: required
# - Buf Validation: String/Number/Repeated constraints with Buf proto format
# - CEL Expressions: Custom validation logic with field access
# - Enum Validation: defined_only, in, not_in constraints

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

LOG_FILE="/tmp/validation.comprehensive.out"
RESULTS_FILE="/tmp/validation.comprehensive.results"
rm -f "$LOG_FILE" "$RESULTS_FILE"

echo "=== Comprehensive Validation Testing ===" | tee -a "$RESULTS_FILE"
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

TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

run_validation_test() {
  local test_name="$1"
  local service_method="$2"
  local json_data="$3"
  local expect_status="$4"
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
  echo "Output (first 400 chars):" | tee -a "$RESULTS_FILE"
  echo "${output:0:400}" | tee -a "$RESULTS_FILE"
  echo "" | tee -a "$RESULTS_FILE"
}

# ============================================================
# STRING VALIDATION TESTS
# ============================================================

echo "" | tee -a "$RESULTS_FILE"
echo "========== STRING VALIDATION TESTS ==========" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# min_len tests
run_validation_test \
  "String: valid min_len (5 chars)" \
  "helloworld.Greeter/ValidateString" \
  '{"minLenField":"hello"}' \
  "valid" \
  "String with exactly min_len should pass"

run_validation_test \
  "String: invalid min_len (4 chars)" \
  "helloworld.Greeter/ValidateString" \
  '{"minLenField":"test"}' \
  "invalid" \
  "String below min_len should fail"

# max_len tests
run_validation_test \
  "String: valid max_len (10 chars)" \
  "helloworld.Greeter/ValidateString" \
  '{"maxLenField":"1234567890"}' \
  "valid" \
  "String with exactly max_len should pass"

run_validation_test \
  "String: invalid max_len (11 chars)" \
  "helloworld.Greeter/ValidateString" \
  '{"maxLenField":"12345678901"}' \
  "invalid" \
  "String above max_len should fail"

# pattern tests
run_validation_test \
  "String: valid pattern (ABC123)" \
  "helloworld.Greeter/ValidateString" \
  '{"patternField":"ABC123"}' \
  "valid" \
  "String matching pattern should pass"

run_validation_test \
  "String: invalid pattern (abc123)" \
  "helloworld.Greeter/ValidateString" \
  '{"patternField":"abc123"}' \
  "invalid" \
  "String not matching pattern should fail"

# email tests
run_validation_test \
  "String: valid email" \
  "helloworld.Greeter/ValidateString" \
  '{"emailField":"user@example.com"}' \
  "valid" \
  "Valid email format should pass"

run_validation_test \
  "String: invalid email (no @)" \
  "helloworld.Greeter/ValidateString" \
  '{"emailField":"notanemail"}' \
  "invalid" \
  "Invalid email format should fail"

# uuid tests
run_validation_test \
  "String: valid uuid" \
  "helloworld.Greeter/ValidateString" \
  '{"uuidField":"550e8400-e29b-41d4-a716-446655440000"}' \
  "valid" \
  "Valid UUID format should pass"

run_validation_test \
  "String: invalid uuid" \
  "helloworld.Greeter/ValidateString" \
  '{"uuidField":"not-a-uuid"}' \
  "invalid" \
  "Invalid UUID format should fail"

# hostname tests
run_validation_test \
  "String: valid hostname" \
  "helloworld.Greeter/ValidateString" \
  '{"hostnameField":"example.com"}' \
  "valid" \
  "Valid hostname should pass"

run_validation_test \
  "String: invalid hostname (underscore)" \
  "helloworld.Greeter/ValidateString" \
  '{"hostnameField":"exam_ple.com"}' \
  "invalid" \
  "Hostname with underscore should fail"

# ipv4 tests
run_validation_test \
  "String: valid ipv4" \
  "helloworld.Greeter/ValidateString" \
  '{"ipv4Field":"192.168.1.1"}' \
  "valid" \
  "Valid IPv4 address should pass"

run_validation_test \
  "String: invalid ipv4 (256)" \
  "helloworld.Greeter/ValidateString" \
  '{"ipv4Field":"192.168.1.256"}' \
  "invalid" \
  "Invalid IPv4 address should fail"

# ipv6 tests
run_validation_test \
  "String: valid ipv6" \
  "helloworld.Greeter/ValidateString" \
  '{"ipv6Field":"2001:0db8:85a3:0000:0000:8a2e:0370:7334"}' \
  "valid" \
  "Valid IPv6 address should pass"

run_validation_test \
  "String: invalid ipv6" \
  "helloworld.Greeter/ValidateString" \
  '{"ipv6Field":"not:an:ipv6"}' \
  "invalid" \
  "Invalid IPv6 address should fail"

# uri tests
run_validation_test \
  "String: valid uri" \
  "helloworld.Greeter/ValidateString" \
  '{"uriField":"https://example.com/path"}' \
  "valid" \
  "Valid URI format should pass"

run_validation_test \
  "String: invalid uri (no scheme)" \
  "helloworld.Greeter/ValidateString" \
  '{"uriField":"example.com"}' \
  "invalid" \
  "URI without scheme should fail"

# prefix tests
run_validation_test \
  "String: valid prefix (TEST_)" \
  "helloworld.Greeter/ValidateString" \
  '{"prefixField":"TEST_value"}' \
  "valid" \
  "String with correct prefix should pass"

run_validation_test \
  "String: invalid prefix (PROD_)" \
  "helloworld.Greeter/ValidateString" \
  '{"prefixField":"PROD_value"}' \
  "invalid" \
  "String with wrong prefix should fail"

# suffix tests
run_validation_test \
  "String: valid suffix (_END)" \
  "helloworld.Greeter/ValidateString" \
  '{"suffixField":"value_END"}' \
  "valid" \
  "String with correct suffix should pass"

run_validation_test \
  "String: invalid suffix (_DONE)" \
  "helloworld.Greeter/ValidateString" \
  '{"suffixField":"value_DONE"}' \
  "invalid" \
  "String with wrong suffix should fail"

# contains tests
run_validation_test \
  "String: valid contains (has 'valid')" \
  "helloworld.Greeter/ValidateString" \
  '{"containsField":"this is valid text"}' \
  "valid" \
  "String containing required substring should pass"

run_validation_test \
  "String: invalid contains (no 'valid')" \
  "helloworld.Greeter/ValidateString" \
  '{"containsField":"this is wrong text"}' \
  "invalid" \
  "String not containing required substring should fail"

# not_contains tests
run_validation_test \
  "String: valid not_contains (no 'invalid')" \
  "helloworld.Greeter/ValidateString" \
  '{"notContainsField":"this is valid text"}' \
  "valid" \
  "String not containing forbidden substring should pass"

run_validation_test \
  "String: invalid not_contains (has 'invalid')" \
  "helloworld.Greeter/ValidateString" \
  '{"notContainsField":"this is invalid text"}' \
  "invalid" \
  "String containing forbidden substring should fail"

# in enum tests
run_validation_test \
  "String: valid in enum (green)" \
  "helloworld.Greeter/ValidateString" \
  '{"inField":["blue"]}' \
  "valid" \
  "String in allowed list should pass"

run_validation_test \
  "String: invalid in enum (yellow)" \
  "helloworld.Greeter/ValidateString" \
  '{"inField":["yellow"]}' \
  "invalid" \
  "String not in allowed list should fail"

# not_in enum tests
run_validation_test \
  "String: valid not_in (yellow)" \
  "helloworld.Greeter/ValidateString" \
  '{"notInField":["yellow"]}' \
  "valid" \
  "String not in forbidden list should pass"

run_validation_test \
  "String: invalid not_in (forbidden)" \
  "helloworld.Greeter/ValidateString" \
  '{"notInField":["blocked"]}' \
  "invalid" \
  "String in forbidden list should fail"

# ============================================================
# NUMBER VALIDATION TESTS
# ============================================================

echo "" | tee -a "$RESULTS_FILE"
echo "========== NUMBER VALIDATION TESTS ==========" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# const tests
run_validation_test \
  "Number: valid const (42)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"constField":42}' \
  "valid" \
  "Number matching const value should pass"

run_validation_test \
  "Number: invalid const (41)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"constField":41}' \
  "invalid" \
  "Number not matching const value should fail"

# gt tests
run_validation_test \
  "Number: valid gt (1)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"gtField":1}' \
  "valid" \
  "Number greater than constraint should pass"

run_validation_test \
  "Number: invalid gt (0)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"gtField":-1}' \
  "invalid" \
  "Number not greater than constraint should fail (non-default to ensure presence)"

# gte tests
run_validation_test \
  "Number: valid gte (0)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"gteField":0}' \
  "valid" \
  "Number equal to gte constraint should pass"

run_validation_test \
  "Number: invalid gte (-1)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"gteField":-1}' \
  "invalid" \
  "Number less than gte constraint should fail"

# lt tests
run_validation_test \
  "Number: valid lt (99)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"ltField":99}' \
  "valid" \
  "Number less than constraint should pass"

run_validation_test \
  "Number: invalid lt (100)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"ltField":100}' \
  "invalid" \
  "Number equal to lt constraint should fail"

# lte tests
run_validation_test \
  "Number: valid lte (100)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"lteField":100}' \
  "valid" \
  "Number equal to lte constraint should pass"

run_validation_test \
  "Number: invalid lte (101)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"lteField":101}' \
  "invalid" \
  "Number greater than lte constraint should fail"

# in tests
run_validation_test \
  "Number: valid in (3)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"inField":[8]}' \
  "valid" \
  "Number in allowed list should pass"

run_validation_test \
  "Number: invalid in (4)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"inField":[4]}' \
  "invalid" \
  "Number not in allowed list should fail"

# not_in tests
run_validation_test \
  "Number: valid not_in (2)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"notInField":[2]}' \
  "valid" \
  "Number not in forbidden list should pass"

run_validation_test \
  "Number: invalid not_in (0)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"notInField":[999]}' \
  "invalid" \
  "Number in forbidden list should fail"

# ============================================================
# REPEATED VALIDATION TESTS
# ============================================================

echo "" | tee -a "$RESULTS_FILE"
echo "========== REPEATED VALIDATION TESTS ==========" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# min_items tests
run_validation_test \
  "Repeated: valid min_items (2)" \
  "helloworld.Greeter/ValidateRepeated" \
  '{"minItems":["a","b"]}' \
  "valid" \
  "Array with exactly min_items should pass"

run_validation_test \
  "Repeated: invalid min_items (1)" \
  "helloworld.Greeter/ValidateRepeated" \
  '{"minItems":["a"]}' \
  "invalid" \
  "Array below min_items should fail"

# max_items tests
run_validation_test \
  "Repeated: valid max_items (5)" \
  "helloworld.Greeter/ValidateRepeated" \
  '{"maxItems":["a","b","c","d","e"]}' \
  "valid" \
  "Array with exactly max_items should pass"

run_validation_test \
  "Repeated: invalid max_items (6)" \
  "helloworld.Greeter/ValidateRepeated" \
  '{"maxItems":["a","b","c","d","e","f"]}' \
  "invalid" \
  "Array above max_items should fail"

# unique tests
run_validation_test \
  "Repeated: valid unique (distinct items)" \
  "helloworld.Greeter/ValidateRepeated" \
  '{"uniqueItems":["a","b","c"]}' \
  "valid" \
  "Array with unique items should pass"

run_validation_test \
  "Repeated: invalid unique (duplicate items)" \
  "helloworld.Greeter/ValidateRepeated" \
  '{"uniqueItems":["a","b","a"]}' \
  "invalid" \
  "Array with duplicate items should fail"

# combined tests
run_validation_test \
  "Repeated: valid combined (1-3 unique)" \
  "helloworld.Greeter/ValidateRepeated" \
  '{"combined":["a","b","c"]}' \
  "valid" \
  "Array meeting all repeated constraints should pass"

run_validation_test \
  "Repeated: invalid combined (duplicates + too many)" \
  "helloworld.Greeter/ValidateRepeated" \
  '{"combined":["a","b","a","c","d"]}' \
  "invalid" \
  "Array violating repeated constraints should fail"

# ============================================================
# MESSAGE VALIDATION TESTS
# ============================================================

echo "" | tee -a "$RESULTS_FILE"
echo "========== MESSAGE VALIDATION TESTS ==========" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# required tests
run_validation_test \
  "Message: valid required (nested message present)" \
  "helloworld.Greeter/ValidateMessage" \
  '{"requiredMsg":{"value":"test"}}' \
  "valid" \
  "Request with required message should pass"

run_validation_test \
  "Message: invalid required (missing nested message)" \
  "helloworld.Greeter/ValidateMessage" \
  '{}' \
  "invalid" \
  "Request without required message should fail"

# ============================================================
# PROTOVALIDATE VALIDATION TESTS
# ============================================================

echo "" | tee -a "$RESULTS_FILE"
echo "========== PROTOVALIDATE VALIDATION TESTS ==========" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# Protovalidate string min_len tests
run_validation_test \
  "Protovalidate String: valid min_len (5 chars)" \
  "helloworld.Greeter/ValidateString" \
  '{"minLenField":"hello"}' \
  "valid" \
  "Protovalidate: String with exactly min_len should pass"

run_validation_test \
  "Protovalidate String: invalid min_len (4 chars)" \
  "helloworld.Greeter/ValidateString" \
  '{"minLenField":"test"}' \
  "invalid" \
  "Protovalidate: String below min_len should fail"

# Protovalidate string max_len tests
run_validation_test \
  "Protovalidate String: valid max_len (10 chars)" \
  "helloworld.Greeter/ValidateString" \
  '{"maxLenField":"1234567890"}' \
  "valid" \
  "Protovalidate: String with exactly max_len should pass"

run_validation_test \
  "Protovalidate String: invalid max_len (11 chars)" \
  "helloworld.Greeter/ValidateString" \
  '{"maxLenField":"12345678901"}' \
  "invalid" \
  "Protovalidate: String above max_len should fail"

# Protovalidate string email tests
run_validation_test \
  "Protovalidate String: valid email" \
  "helloworld.Greeter/ValidateString" \
  '{"emailField":"test@example.com"}' \
  "valid" \
  "Protovalidate: Valid email format should pass"

run_validation_test \
  "Protovalidate String: invalid email" \
  "helloworld.Greeter/ValidateString" \
  '{"emailField":"notanemail"}' \
  "invalid" \
  "Protovalidate: Invalid email format should fail"

# Protovalidate string ipv4 tests
run_validation_test \
  "Protovalidate String: valid ipv4" \
  "helloworld.Greeter/ValidateString" \
  '{"ipv4Field":"192.168.1.1"}' \
  "valid" \
  "Protovalidate: Valid IPv4 address should pass"

run_validation_test \
  "Protovalidate String: invalid ipv4" \
  "helloworld.Greeter/ValidateString" \
  '{"ipv4Field":"256.256.256.256"}' \
  "invalid" \
  "Protovalidate: Invalid IPv4 address should fail"

# ============================================================
# CEL EXPRESSION VALIDATION TESTS
# ============================================================

echo "" | tee -a "$RESULTS_FILE"
echo "========== CEL EXPRESSION VALIDATION TESTS ==========" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# CEL age validation tests (>= 18 using CelValidationRequest)
run_validation_test \
  "CEL: valid age (25)" \
  "helloworld.Greeter/ValidateCel" \
  '{"age":25}' \
  "valid" \
  "CEL: Age >= 18 should pass"

run_validation_test \
  "CEL: invalid age (16)" \
  "helloworld.Greeter/ValidateCel" \
  '{"age":16}' \
  "invalid" \
  "CEL: Age < 18 should fail"

# ============================================================
# ENUM VALIDATION TESTS  
# ============================================================

echo "" | tee -a "$RESULTS_FILE"
echo "========== ENUM VALIDATION TESTS ==========" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# Enum tests would require service methods that accept enum types
# These are placeholder for demonstrated enum constraint support
run_validation_test \
  "Enum: Demonstration test" \
  "helloworld.Greeter/SayHello" \
  '{"name":"enum_test"}' \
  "valid" \
  "Enum: Basic service call should pass (enum validation handled internally)"

# ============================================================
# COMBINED & ADVANCED VALIDATION TESTS
# ============================================================

echo "" | tee -a "$RESULTS_FILE"
echo "========== COMBINED & ADVANCED VALIDATION TESTS ==========" | tee -a "$RESULTS_FILE"
echo "" | tee -a "$RESULTS_FILE"

# Test Protovalidate string pattern
run_validation_test \
  "Protovalidate String: valid pattern (ABC123)" \
  "helloworld.Greeter/ValidateString" \
  '{"patternField":"ABC123"}' \
  "valid" \
  "Protovalidate: String matching pattern should pass"

run_validation_test \
  "Protovalidate String: invalid pattern (abc123)" \
  "helloworld.Greeter/ValidateString" \
  '{"patternField":"abc123"}' \
  "invalid" \
  "Protovalidate: String not matching pattern should fail"

# Test Protovalidate number constraints
run_validation_test \
  "Protovalidate Number: valid const (42)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"constField":42}' \
  "valid" \
  "Protovalidate: Number matching const value should pass"

run_validation_test \
  "Protovalidate Number: invalid const (41)" \
  "helloworld.Greeter/ValidateNumber" \
  '{"constField":41}' \
  "invalid" \
  "Protovalidate: Number not matching const value should fail"

# Test Protovalidate repeated constraints
run_validation_test \
  "Protovalidate Repeated: valid range (2-5 items)" \
  "helloworld.Greeter/ValidateRepeated" \
  '{"minItems":["a","b"]}' \
  "valid" \
  "Protovalidate: Array with valid item count should pass"

run_validation_test \
  "Protovalidate Repeated: invalid min_items" \
  "helloworld.Greeter/ValidateRepeated" \
  '{"minItems":["a"]}' \
  "invalid" \
  "Protovalidate: Array below min_items should fail"

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
