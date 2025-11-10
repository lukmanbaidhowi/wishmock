#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ARTIFACTS_DIR="$PROJECT_ROOT/artifacts/grpcurl"

REQUEST_FILE=""
EXPECTED_FILE=""
GRPCURL_PATH="grpcurl"
STAGE="all"
TIMEOUT=150
CI_MODE=false
RUN_ID="$(date +%Y%m%d_%H%M%S)"

function usage() {
  cat <<EOF
Usage: $0 [OPTIONS]

Docker grpcurl smoke test runner

OPTIONS:
  --request <path>        Path to JSON request fixture (required)
  --expected <path>       Path to expected JSON response (required)
  --grpcurl-path <path>   Override grpcurl binary path (default: grpcurl)
  --stage <name>          Run specific stage: start|invoke|cleanup (default: all)
  --timeout <seconds>     Stack readiness timeout (default: 150)
  --ci                    Enable CI mode (non-interactive, exports GRPCURL_RUN_ID)
  -h, --help              Show this help

EXIT CODES:
  0   Success - response matches expected
  10  Docker stack failed to start
  20  grpcurl execution failed
  30  Response diff detected
  40  Script misconfiguration
EOF
  exit 0
}

function log() {
  echo "[grpcurl-smoke] $*"
}

function error() {
  echo "[grpcurl-smoke] ERROR: $*" >&2
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --request)
      REQUEST_FILE="$2"
      shift 2
      ;;
    --expected)
      EXPECTED_FILE="$2"
      shift 2
      ;;
    --grpcurl-path)
      GRPCURL_PATH="$2"
      shift 2
      ;;
    --stage)
      STAGE="$2"
      shift 2
      ;;
    --timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    --ci)
      CI_MODE=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      error "Unknown option: $1"
      usage
      ;;
  esac
done

if [[ "$STAGE" == "all" ]] || [[ "$STAGE" == "invoke" ]]; then
  if [[ -z "$REQUEST_FILE" ]] || [[ -z "$EXPECTED_FILE" ]]; then
    error "Missing required arguments: --request and --expected"
    exit 40
  fi

  if [[ ! -f "$REQUEST_FILE" ]]; then
    error "Request file not found: $REQUEST_FILE"
    exit 40
  fi

  if [[ ! -f "$EXPECTED_FILE" ]]; then
    error "Expected response file not found: $EXPECTED_FILE"
    exit 40
  fi
fi

if ! command -v "$GRPCURL_PATH" &> /dev/null; then
  error "grpcurl not found at: $GRPCURL_PATH"
  exit 40
fi

RUN_DIR="$ARTIFACTS_DIR/$RUN_ID"
mkdir -p "$RUN_DIR"

if [[ "$CI_MODE" == true ]]; then
  export GRPCURL_RUN_ID="$RUN_ID"
fi

METADATA_FILE="$RUN_DIR/metadata.json"
START_TIME=$(date +%s)

function write_metadata() {
  local status=$1
  local duration=$2
  local details=${3:-"{}"}
  
  cat > "$METADATA_FILE" <<EOF
{
  "run_id": "$RUN_ID",
  "status": "$status",
  "duration_ms": $((duration * 1000)),
  "timestamp": "$(date -Iseconds)",
  "ci_mode": $CI_MODE,
  "details": $details
}
EOF
}

function stage_start() {
  log "Starting docker stack..."
  
  cd "$PROJECT_ROOT"
  
  if ! docker compose -f docker-compose.yml up --detach --wait --timeout "$TIMEOUT" 2>&1 | tee "$RUN_DIR/docker-logs.txt"; then
    error "Docker stack failed to start"
    END_TIME=$(date +%s)
    write_metadata "error" $((END_TIME - START_TIME)) '{"error": "docker_start_failed"}'
    exit 10
  fi
  
  log "Waiting for liveness check on port 3000..."
  local max_attempts=30
  local attempt=0
  
  while [[ $attempt -lt $max_attempts ]]; do
    if curl -sf http://localhost:3000/liveness > /dev/null 2>&1; then
      log "Stack is ready"
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 2
  done
  
  error "Stack failed liveness check"
  END_TIME=$(date +%s)
  write_metadata "error" $((END_TIME - START_TIME)) '{"error": "liveness_check_failed"}'
  exit 10
}

function stage_invoke() {
  log "Invoking grpcurl..."
  
  local actual_response="$RUN_DIR/response.actual.json"
  local expected_copy="$RUN_DIR/response.expected.json"
  local diff_file="$RUN_DIR/diff.json"
  
  cp "$EXPECTED_FILE" "$expected_copy"
  
  if ! "$GRPCURL_PATH" -plaintext \
    -import-path "$PROJECT_ROOT/protos" \
    -proto helloworld.proto \
    -format json \
    -d @ \
    localhost:50050 helloworld.Greeter/SayHello < "$REQUEST_FILE" > "$actual_response" 2>&1; then
    error "grpcurl execution failed"
    cat "$actual_response"
    END_TIME=$(date +%s)
    write_metadata "error" $((END_TIME - START_TIME)) '{"error": "grpcurl_failed"}'
    exit 20
  fi
  
  log "Comparing response with expected..."
  
  if ! node "$PROJECT_ROOT/scripts/helpers/assert-json-diff.mjs" \
    "$actual_response" \
    "$expected_copy" \
    "$diff_file"; then
    error "Response differs from expected"
    cat "$diff_file"
    END_TIME=$(date +%s)
    write_metadata "fail" $((END_TIME - START_TIME)) "$(cat "$diff_file")"
    exit 30
  fi
  
  log "Response matches expected ✓"
  END_TIME=$(date +%s)
  write_metadata "pass" $((END_TIME - START_TIME))
}

function stage_cleanup() {
  log "Cleaning up docker stack..."
  cd "$PROJECT_ROOT"
  docker compose -f docker-compose.yml down --remove-orphans > /dev/null 2>&1 || true
}

case "$STAGE" in
  all)
    stage_start
    stage_invoke
    stage_cleanup
    ;;
  start)
    stage_start
    ;;
  invoke)
    stage_invoke
    ;;
  cleanup)
    stage_cleanup
    ;;
  *)
    error "Unknown stage: $STAGE"
    exit 40
    ;;
esac

log "Smoke test completed successfully"
exit 0

