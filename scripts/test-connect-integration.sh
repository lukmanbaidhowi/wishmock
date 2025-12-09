#!/usr/bin/env bash
set -euo pipefail

# Integration test script for Connect RPC migration
# Tests all three protocols: Connect, gRPC-Web, and native gRPC
#
# This script:
# 1. Starts Wishmock with Connect RPC enabled
# 2. Tests Connect protocol (JSON-based)
# 3. Tests gRPC-Web protocol (browser-compatible)
# 4. Tests native gRPC protocol (backward compatibility)
# 5. Reports results for all protocols
#
# Env overrides:
#   HTTP_PORT                 (default: 4319)
#   GRPC_PORT_PLAINTEXT       (default: 50050)
#   CONNECT_PORT              (default: 8080)
#   TIMEOUT                   (default: 30 seconds)
#   RUNNER                    (bun|node) autodetect by default

have() { command -v "$1" >/dev/null 2>&1; }

# Configuration
HTTP_PORT="${HTTP_PORT:-4319}"
GRPC_PORT="${GRPC_PORT_PLAINTEXT:-50050}"
CONNECT_PORT="${CONNECT_PORT:-50052}"
TIMEOUT="${TIMEOUT:-30}"

# Find an available port if the default is in use
find_available_port() {
  local port=$1
  while netstat -tuln 2>/dev/null | grep -q ":${port} " || ss -tuln 2>/dev/null | grep -q ":${port} "; do
    port=$((port + 1))
  done
  echo $port
}

# Check if Connect port is available, if not find another one
if netstat -tuln 2>/dev/null | grep -q ":${CONNECT_PORT} " || ss -tuln 2>/dev/null | grep -q ":${CONNECT_PORT} "; then
  ORIGINAL_PORT=$CONNECT_PORT
  CONNECT_PORT=$(find_available_port $((CONNECT_PORT + 1)))
  echo "⚠️  Port $ORIGINAL_PORT is in use. Using port $CONNECT_PORT instead"
fi

# Check required tools
if ! have grpcurl; then
  echo "ERROR: grpcurl not found in PATH" >&2
  exit 127
fi
if ! have curl; then
  echo "ERROR: curl not found in PATH" >&2
  exit 127
fi
if ! have node; then
  echo "ERROR: node not found in PATH" >&2
  exit 127
fi

# Determine runner
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

# Export environment variables for the server
export HTTP_PORT
export GRPC_PORT_PLAINTEXT="$GRPC_PORT"
export CONNECT_ENABLED="true"
export CONNECT_PORT
export CONNECT_CORS_ENABLED="true"
export CONNECT_CORS_ORIGINS="*"

# Log files
LOG_FILE="/tmp/wishmock.connect.test.out"
RESULTS_FILE="/tmp/wishmock.connect.results"
rm -f "$LOG_FILE" "$RESULTS_FILE"

echo "=========================================="
echo "Connect RPC Integration Test"
echo "=========================================="
echo ""
echo "Configuration:"
echo "  Runner:       $RUNNER"
echo "  HTTP Port:    $HTTP_PORT"
echo "  gRPC Port:    $GRPC_PORT"
echo "  Connect Port: $CONNECT_PORT"
echo "  Timeout:      ${TIMEOUT}s"
echo ""

# Setup example rules
echo "📋 Setting up example rules..."
bash examples/connect-client/setup.sh >>"$LOG_FILE" 2>&1 || true
echo ""

# Start server
echo "🚀 Starting Wishmock server with Connect RPC enabled..."
"${START_CMD[@]}" >>"$LOG_FILE" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID >/dev/null 2>&1 || true' EXIT
echo "   Server PID: $SERVER_PID"

# Wait for readiness
echo -n "⏳ Waiting for server readiness"
for i in $(seq 1 $((TIMEOUT*2))); do
  if curl -fsS "http://localhost:${HTTP_PORT}/readiness" >/dev/null 2>&1; then
    echo " ✅"
    break
  fi
  sleep 0.5
  echo -n "."
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo -e "\n❌ Server exited early. Logs:" >&2
    cat "$LOG_FILE" >&2
    exit 1
  fi
done

if ! curl -fsS "http://localhost:${HTTP_PORT}/readiness" >/dev/null 2>&1; then
  echo -e "\n❌ Timeout waiting for readiness. Logs:" >&2
  cat "$LOG_FILE" >&2
  exit 1
fi

# Check server status
echo ""
echo "📊 Server Status:"
curl -fsS "http://localhost:${HTTP_PORT}/admin/status" | grep -E '"(grpc|connect|http)"' || true
echo ""

# Initialize test counters
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# Test result tracking
declare -a TEST_RESULTS

run_test() {
  local protocol="$1"
  local test_name="$2"
  shift 2
  
  TOTAL_TESTS=$((TOTAL_TESTS + 1))
  local test_id="${protocol}:${test_name}"
  
  echo -n "  Testing: $test_name... "
  
  set +e
  local output
  output=$("$@" 2>&1)
  local exit_code=$?
  set -e
  
  if [[ $exit_code -eq 0 ]]; then
    echo "✅"
    PASSED_TESTS=$((PASSED_TESTS + 1))
    TEST_RESULTS+=("✅ $test_id")
  else
    echo "❌"
    FAILED_TESTS=$((FAILED_TESTS + 1))
    TEST_RESULTS+=("❌ $test_id")
    echo "     Error: $output" | head -n 3
  fi
}

# ============================================================
# TEST 1: CONNECT PROTOCOL (JSON-based)
# ============================================================

echo ""
echo "=========================================="
echo "TEST 1: Connect Protocol (JSON)"
echo "=========================================="
echo ""

# Test 1.1: Health check
run_test "Connect" "Health check" \
  curl -fsS "http://localhost:${CONNECT_PORT}/health"

# Test 1.2: Unary RPC
run_test "Connect" "Unary RPC (SayHello)" \
  curl -fsS -X POST "http://localhost:${CONNECT_PORT}/helloworld.Greeter/SayHello" \
    -H "Content-Type: application/json" \
    -H "Connect-Protocol-Version: 1" \
    -d '{"name":"ConnectTest"}'

# Test 1.3: Server streaming RPC
run_test "Connect" "Server Streaming (GetMessages)" \
  timeout 5s curl -fsS -X POST "http://localhost:${CONNECT_PORT}/streaming.StreamService/GetMessages" \
    -H "Content-Type: application/json" \
    -H "Connect-Protocol-Version: 1" \
    -H "Connect-Accept-Encoding: identity" \
    -d '{"user_id":"test","limit":3}'

# Test 1.4: Server streaming RPC (WatchEvents)
run_test "Connect" "Server Streaming (WatchEvents)" \
  timeout 5s curl -fsS -X POST "http://localhost:${CONNECT_PORT}/streaming.StreamService/WatchEvents" \
    -H "Content-Type: application/json" \
    -H "Connect-Protocol-Version: 1" \
    -H "Connect-Accept-Encoding: identity" \
    -d '{"topic":"test","filters":["important"]}'

# Test 1.5: CORS preflight
run_test "Connect" "CORS preflight (OPTIONS)" \
  curl -fsS -X OPTIONS "http://localhost:${CONNECT_PORT}/helloworld.Greeter/SayHello" \
    -H "Origin: http://localhost:3000" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Content-Type"

# Test 1.6: Run Node.js Connect client example
echo "  Running Node.js Connect client example..."
if node examples/connect-client/node.mjs --server "http://localhost:${CONNECT_PORT}" >>"$LOG_FILE" 2>&1; then
  echo "    ✅ Node.js Connect client example passed"
  PASSED_TESTS=$((PASSED_TESTS + 1))
  TEST_RESULTS+=("✅ Connect:Node.js client example")
else
  echo "    ❌ Node.js Connect client example failed"
  FAILED_TESTS=$((FAILED_TESTS + 1))
  TEST_RESULTS+=("❌ Connect:Node.js client example")
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

# ============================================================
# TEST 2: gRPC-WEB PROTOCOL (Browser-compatible)
# ============================================================

echo ""
echo "=========================================="
echo "TEST 2: gRPC-Web Protocol"
echo "=========================================="
echo ""

# Test 2.1: Unary RPC with gRPC-Web headers
run_test "gRPC-Web" "Unary RPC (SayHello)" \
  curl -fsS -X POST "http://localhost:${CONNECT_PORT}/helloworld.Greeter/SayHello" \
    -H "Content-Type: application/grpc-web+json" \
    -H "X-Grpc-Web: 1" \
    -H "Accept: application/grpc-web+json" \
    -d '{"name":"gRPC-Web-Test"}'

# Test 2.2: Server streaming with gRPC-Web
run_test "gRPC-Web" "Server Streaming (GetMessages)" \
  timeout 5s curl -fsS -X POST "http://localhost:${CONNECT_PORT}/streaming.StreamService/GetMessages" \
    -H "Content-Type: application/grpc-web+json" \
    -H "X-Grpc-Web: 1" \
    -H "Accept: application/grpc-web+json" \
    -d '{"user_id":"grpc-web-test","limit":3}'

# Test 2.3: CORS with gRPC-Web
run_test "gRPC-Web" "CORS preflight" \
  curl -fsS -X OPTIONS "http://localhost:${CONNECT_PORT}/helloworld.Greeter/SayHello" \
    -H "Origin: http://localhost:3000" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: Content-Type,X-Grpc-Web"

# Test 2.4: Run Node.js gRPC-Web client example
echo "  Running Node.js gRPC-Web client example..."
if node examples/grpc-web-connect/node.mjs --server "http://localhost:${CONNECT_PORT}" >>"$LOG_FILE" 2>&1; then
  echo "    ✅ Node.js gRPC-Web client example passed"
  PASSED_TESTS=$((PASSED_TESTS + 1))
  TEST_RESULTS+=("✅ gRPC-Web:Node.js client example")
else
  echo "    ❌ Node.js gRPC-Web client example failed"
  FAILED_TESTS=$((FAILED_TESTS + 1))
  TEST_RESULTS+=("❌ gRPC-Web:Node.js client example")
fi
TOTAL_TESTS=$((TOTAL_TESTS + 1))

# ============================================================
# TEST 3: NATIVE gRPC PROTOCOL (Backward compatibility)
# ============================================================

echo ""
echo "=========================================="
echo "TEST 3: Native gRPC Protocol"
echo "=========================================="
echo ""

# Test 3.1: gRPC reflection
run_test "gRPC" "Reflection (list services)" \
  grpcurl -plaintext "localhost:${GRPC_PORT}" list

# Test 3.2: Unary RPC via native gRPC
run_test "gRPC" "Unary RPC (SayHello)" \
  grpcurl -import-path protos -proto helloworld.proto -plaintext \
    -d '{"name":"gRPC-Native-Test"}' \
    "localhost:${GRPC_PORT}" helloworld.Greeter/SayHello

# Test 3.3: Server streaming via native gRPC
run_test "gRPC" "Server Streaming (GetMessages)" \
  timeout 5s grpcurl -import-path protos -proto streaming.proto -plaintext \
    -d '{"user_id":"grpc-test","limit":3}' \
    "localhost:${GRPC_PORT}" streaming.StreamService/GetMessages

# Test 3.4: Client streaming via native gRPC
run_test "gRPC" "Client Streaming (UploadHello)" \
  sh -c "printf '%s\\n%s\\n' '{\"name\":\"Alice\"}' '{\"name\":\"Bob\"}' | \
    grpcurl -import-path protos -proto helloworld.proto -plaintext -d @ \
    \"localhost:${GRPC_PORT}\" helloworld.Greeter/UploadHello"

# Test 3.5: Bidirectional streaming via native gRPC
run_test "gRPC" "Bidi Streaming (ChatHello)" \
  sh -c "printf '%s\\n%s\\n' '{\"name\":\"Alice\"}' '{\"name\":\"Bob\"}' | \
    grpcurl -import-path protos -proto helloworld.proto -plaintext -d @ \
    \"localhost:${GRPC_PORT}\" helloworld.Greeter/ChatHello"

# Test 3.6: Describe service via reflection
run_test "gRPC" "Reflection (describe service)" \
  grpcurl -plaintext "localhost:${GRPC_PORT}" describe helloworld.Greeter

# ============================================================
# TEST 4: CROSS-PROTOCOL VALIDATION
# ============================================================

echo ""
echo "=========================================="
echo "TEST 4: Cross-Protocol Validation"
echo "=========================================="
echo ""

# Test 4.1: Same request via all three protocols
echo "  Testing same request via all protocols..."

# Connect protocol
CONNECT_RESULT=$(curl -fsS -X POST "http://localhost:${CONNECT_PORT}/helloworld.Greeter/SayHello" \
  -H "Content-Type: application/json" \
  -H "Connect-Protocol-Version: 1" \
  -d '{"name":"CrossProtocolTest"}' 2>&1 || echo "FAILED")

# gRPC-Web protocol
GRPC_WEB_RESULT=$(curl -fsS -X POST "http://localhost:${CONNECT_PORT}/helloworld.Greeter/SayHello" \
  -H "Content-Type: application/grpc-web+json" \
  -H "X-Grpc-Web: 1" \
  -d '{"name":"CrossProtocolTest"}' 2>&1 || echo "FAILED")

# Native gRPC protocol
GRPC_RESULT=$(grpcurl -import-path protos -proto helloworld.proto -plaintext \
  -d '{"name":"CrossProtocolTest"}' \
  "localhost:${GRPC_PORT}" helloworld.Greeter/SayHello 2>&1 || echo "FAILED")

TOTAL_TESTS=$((TOTAL_TESTS + 1))
if [[ "$CONNECT_RESULT" != "FAILED" ]] && [[ "$GRPC_WEB_RESULT" != "FAILED" ]] && [[ "$GRPC_RESULT" != "FAILED" ]]; then
  echo "    ✅ All three protocols returned successful responses"
  PASSED_TESTS=$((PASSED_TESTS + 1))
  TEST_RESULTS+=("✅ Cross-Protocol:Same request via all protocols")
else
  echo "    ❌ One or more protocols failed"
  FAILED_TESTS=$((FAILED_TESTS + 1))
  TEST_RESULTS+=("❌ Cross-Protocol:Same request via all protocols")
fi

# Test 4.2: Verify Connect server is reported in status
echo "  Verifying Connect server status..."
STATUS_JSON=$(curl -fsS "http://localhost:${HTTP_PORT}/admin/status")
TOTAL_TESTS=$((TOTAL_TESTS + 1))
if echo "$STATUS_JSON" | grep -q '"connect"' && echo "$STATUS_JSON" | grep -q '"enabled":true'; then
  echo "    ✅ Connect server status reported correctly"
  PASSED_TESTS=$((PASSED_TESTS + 1))
  TEST_RESULTS+=("✅ Cross-Protocol:Connect status in admin API")
else
  echo "    ❌ Connect server status not found or incorrect"
  FAILED_TESTS=$((FAILED_TESTS + 1))
  TEST_RESULTS+=("❌ Cross-Protocol:Connect status in admin API")
fi

# ============================================================
# RESULTS SUMMARY
# ============================================================

echo ""
echo "=========================================="
echo "TEST RESULTS SUMMARY"
echo "=========================================="
echo ""
echo "Total Tests:  $TOTAL_TESTS"
echo "Passed:       $PASSED_TESTS ✅"
echo "Failed:       $FAILED_TESTS ❌"
echo ""

if [[ $FAILED_TESTS -eq 0 ]]; then
  echo "🎉 ALL TESTS PASSED!"
  echo ""
  echo "✅ Connect Protocol:    Working"
  echo "✅ gRPC-Web Protocol:   Working"
  echo "✅ Native gRPC:         Working"
  echo "✅ Cross-Protocol:      Validated"
  echo ""
  echo "The Connect RPC migration is successful!"
  echo "All three protocols work seamlessly together."
else
  echo "⚠️  SOME TESTS FAILED"
  echo ""
  echo "Failed tests:"
  for result in "${TEST_RESULTS[@]}"; do
    if [[ "$result" == ❌* ]]; then
      echo "  $result"
    fi
  done
  echo ""
  echo "Check logs at: $LOG_FILE"
fi

echo ""
echo "Detailed logs: $LOG_FILE"
echo ""

# Exit with appropriate code
if [[ $FAILED_TESTS -eq 0 ]]; then
  exit 0
else
  exit 1
fi
