#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_version.sh"
source "${SCRIPT_DIR}/_artifacts.sh"

COMPOSE_FILE=""
STRICT_MODE=false

usage() {
  cat <<EOF
Usage: $0 --file <compose-file> [--strict]

Validate Docker Compose file syntax and configuration.

Options:
  --file <path>    Path to compose file (required)
  --strict         Treat warnings as errors
  -h, --help       Show this help message

Exit codes:
  0: Validation succeeded
  1: Version mismatch or invalid arguments
  2: Lint failure

Example:
  $0 --file docker-compose.yml
  $0 --file node-docker-compose.yaml --strict
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
      --strict)
        STRICT_MODE=true
        shift
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

main() {
  parse_args "$@"

  if ! guard_compose_version; then
    exit 1
  fi

  ensure_artifacts_base

  local start_ms=$(($(date +%s%N)/1000000))
  local status="ok"
  local artifact_dir
  artifact_dir=$(create_artifact_dir)

  echo "Linting compose file: $COMPOSE_FILE"
  
  local lint_output
  local lint_exit=0
  
  lint_output=$(docker compose -f "$COMPOSE_FILE" config --quiet 2>&1) || lint_exit=$?

  local end_ms=$(($(date +%s%N)/1000000))
  local duration_ms=$((end_ms - start_ms))

  if [[ $lint_exit -ne 0 ]]; then
    status="error"
    echo "ERROR: Lint failed for $COMPOSE_FILE" >&2
    echo "$lint_output" >&2
    
    echo "$lint_output" | write_artifact "$artifact_dir" "lint-error.log"
    
    local summary
    summary=$(cat <<EOF
{
  "file": "$COMPOSE_FILE",
  "status": "$status",
  "duration_ms": $duration_ms,
  "exit_code": $lint_exit
}
EOF
)
    echo "$summary" | write_artifact "$artifact_dir" "lint.json"
    echo "$summary"
    
    exit 2
  fi

  echo "✓ Lint passed for $COMPOSE_FILE"
  
  local summary
  summary=$(cat <<EOF
{
  "file": "$COMPOSE_FILE",
  "status": "$status",
  "duration_ms": $duration_ms,
  "exit_code": 0
}
EOF
)
  echo "$summary" | write_artifact "$artifact_dir" "lint.json"
  echo "$summary"
  
  exit 0
}

main "$@"
