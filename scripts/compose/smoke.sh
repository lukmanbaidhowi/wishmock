#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_version.sh"
source "${SCRIPT_DIR}/_artifacts.sh"

COMPOSE_FILE=""
SERVICES=""
TIMEOUT=120

usage() {
  cat <<EOF
Usage: $0 --file <compose-file> [--services <list>] [--timeout <seconds>]

Boot services and verify health endpoints.

Options:
  --file <path>         Path to compose file (required)
  --services <list>     Comma-separated service names (optional)
  --timeout <seconds>   Wait timeout in seconds (default: 120)
  -h, --help            Show this help message

Exit codes:
  0: Smoke test passed
  1: Version mismatch or invalid arguments
  3: Smoke test failed or healthchecks timed out

Example:
  $0 --file docker-compose.yml
  $0 --file node-docker-compose.yaml --services wishmock-cluster --timeout 180
EOF
  exit 0
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --file)
        COMPOSE_FILE="$2"
        shift 2
        ;;
      --services)
        SERVICES="$2"
        shift 2
        ;;
      --timeout)
        TIMEOUT="$2"
        shift 2
        ;;
      -h|--help)
        usage
        ;;
      *)
        echo "ERROR: Unknown option: $1" >&2
        echo "Run '$0 --help' for usage information" >&2
        exit 1
        ;;
    esac
  done

  if [[ -z "$COMPOSE_FILE" ]]; then
    echo "ERROR: --file is required" >&2
    echo "Run '$0 --help' for usage information" >&2
    exit 1
  fi

  if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "ERROR: Compose file not found: $COMPOSE_FILE" >&2
    exit 1
  fi
}

cleanup() {
  local artifact_dir="$1"
  
  echo "Capturing container states..."
  docker compose -f "$COMPOSE_FILE" ps --format json 2>&1 | \
    write_artifact "$artifact_dir" "smoke/ps.json" || true
  
  echo "Capturing container logs..."
  docker compose -f "$COMPOSE_FILE" logs --timestamps 2>&1 | \
    write_artifact "$artifact_dir" "smoke/logs.txt" || true
  
  echo "Cleaning up containers..."
  docker compose -f "$COMPOSE_FILE" down --remove-orphans 2>&1 || true
  
  echo "Cleanup complete (uploads/ volume preserved)"
}

check_docker_context() {
  if ! docker info >/dev/null 2>&1; then
    echo "WARNING: Cannot connect to Docker daemon" >&2
    echo "Verify Docker is running and accessible:" >&2
    echo "  - Check: docker ps" >&2
    echo "  - Context: docker context ls" >&2
    echo "  - Rootless: ensure DOCKER_HOST is set" >&2
    return 1
  fi

  local context_name
  context_name=$(docker context show 2>/dev/null || echo "default")
  
  echo "Docker context: $context_name"
  
  if docker context inspect "$context_name" 2>/dev/null | grep -q "rootless"; then
    echo "NOTE: Rootless Docker detected"
  fi
  
  return 0
}

main() {
  parse_args "$@"

  if ! guard_compose_version; then
    exit 1
  fi

  if ! check_docker_context; then
    echo "SKIP: Docker not accessible, cannot run smoke tests" >&2
    exit 0
  fi

  ensure_artifacts_base

  local start_ms=$(($(date +%s%N)/1000000))
  local artifact_dir
  artifact_dir=$(create_artifact_dir)
  
  mkdir -p "${artifact_dir}/smoke"

  local services_arg=""
  if [[ -n "$SERVICES" ]]; then
    services_arg="$SERVICES"
  fi

  echo "Starting compose stack: $COMPOSE_FILE"
  echo "Timeout: ${TIMEOUT}s"
  
  local up_exit=0
  local up_output
  
  if [[ -n "$services_arg" ]]; then
    up_output=$(docker compose -f "$COMPOSE_FILE" up --detach --wait --wait-timeout "$TIMEOUT" $services_arg 2>&1) || up_exit=$?
  else
    up_output=$(docker compose -f "$COMPOSE_FILE" up --detach --wait --wait-timeout "$TIMEOUT" 2>&1) || up_exit=$?
  fi

  if [[ $up_exit -ne 0 ]]; then
    echo "ERROR: Failed to start services" >&2
    echo "$up_output" >&2
    
    cleanup "$artifact_dir"
    
    local end_ms=$(($(date +%s%N)/1000000))
    local duration_ms=$((end_ms - start_ms))
    
    local summary
    summary=$(cat <<EOF
{
  "file": "$COMPOSE_FILE",
  "status": "error",
  "duration_ms": $duration_ms,
  "exit_code": $up_exit,
  "phase": "startup"
}
EOF
)
    echo "$summary" | write_artifact "$artifact_dir" "smoke.json"
    echo "$summary"
    
    exit 3
  fi

  echo "✓ Services started successfully"
  
  local startup_end_ms=$(($(date +%s%N)/1000000))
  local startup_duration_ms=$((startup_end_ms - start_ms))
  
  sleep 2
  
  echo "Verifying health endpoints..."
  local health_failed=0
  local healthcheck_start_ms=$(($(date +%s%N)/1000000))
  
  if command -v curl &>/dev/null; then
    if ! curl -f -s http://localhost:3000/liveness >/dev/null 2>&1; then
      echo "WARNING: Health check failed for http://localhost:3000/liveness" >&2
      health_failed=1
    else
      echo "✓ Health check passed: http://localhost:3000/liveness"
    fi
  else
    echo "SKIP: curl not available, skipping health checks"
  fi
  
  local healthcheck_end_ms=$(($(date +%s%N)/1000000))
  local healthcheck_duration_ms=$((healthcheck_end_ms - healthcheck_start_ms))

  cleanup "$artifact_dir"

  local end_ms=$(($(date +%s%N)/1000000))
  local duration_ms=$((end_ms - start_ms))

  if [[ $health_failed -ne 0 ]]; then
    echo "ERROR: Health checks failed" >&2
    
    local summary
    summary=$(cat <<EOF
{
  "file": "$COMPOSE_FILE",
  "status": "error",
  "duration_ms": $duration_ms,
  "exit_code": 3,
  "phase": "healthcheck"
}
EOF
)
    echo "$summary" | write_artifact "$artifact_dir" "smoke.json"
    echo "$summary"
    
    exit 3
  fi

  echo "✓ Smoke test passed for $COMPOSE_FILE"
  
  local summary
  summary=$(cat <<EOF
{
  "file": "$COMPOSE_FILE",
  "status": "ok",
  "duration_ms": $duration_ms,
  "exit_code": 0
}
EOF
)
  echo "$summary" | write_artifact "$artifact_dir" "smoke.json"
  
  local run_metrics
  run_metrics=$(cat <<EOF
{
  "start_time": "$(date -u -d @$((start_ms / 1000)) +%Y-%m-%dT%H:%M:%SZ)",
  "end_time": "$(date -u -d @$((end_ms / 1000)) +%Y-%m-%dT%H:%M:%SZ)",
  "total_duration_ms": $duration_ms,
  "startup_duration_ms": $startup_duration_ms,
  "healthcheck_duration_ms": $healthcheck_duration_ms,
  "compose_file": "$COMPOSE_FILE",
  "timeout_seconds": $TIMEOUT
}
EOF
)
  echo "$run_metrics" | write_artifact "$artifact_dir" "run-metrics.json"
  
  echo "$summary"
  
  exit 0
}

main "$@"
