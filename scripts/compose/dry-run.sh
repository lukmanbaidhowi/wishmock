#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/_version.sh"
source "${SCRIPT_DIR}/_artifacts.sh"

COMPOSE_FILE=""

usage() {
  cat <<EOF
Usage: $0 --file <compose-file>

Preview planned Docker Compose actions without mutating state.

Options:
  --file <path>    Path to compose file (required)
  -h, --help       Show this help message

Exit codes:
  0: Dry-run succeeded
  1: Version mismatch or invalid arguments
  2: Dry-run failure (planned removals or errors)

Example:
  $0 --file docker-compose.yml
  $0 --file node-docker-compose.yaml
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
  local artifact_dir
  artifact_dir=$(create_artifact_dir)

  echo "Running dry-run for compose file: $COMPOSE_FILE"
  
  local dryrun_output
  local dryrun_exit=0
  
  dryrun_output=$(docker compose -f "$COMPOSE_FILE" up --dry-run 2>&1) || dryrun_exit=$?

  local end_ms=$(($(date +%s%N)/1000000))
  local duration_ms=$((end_ms - start_ms))

  echo "$dryrun_output" | write_artifact "$artifact_dir" "dry-run.log"

  if [[ $dryrun_exit -ne 0 ]]; then
    echo "ERROR: Dry-run failed for $COMPOSE_FILE" >&2
    echo "$dryrun_output" >&2
    
    local summary
    summary=$(cat <<EOF
{
  "file": "$COMPOSE_FILE",
  "status": "error",
  "duration_ms": $duration_ms,
  "exit_code": $dryrun_exit
}
EOF
)
    echo "$summary" | write_artifact "$artifact_dir" "dry-run.json"
    echo "$summary"
    
    exit 2
  fi

  if echo "$dryrun_output" | grep -qi "remove\|recreate"; then
    echo "WARNING: Dry-run shows destructive changes (remove/recreate)" >&2
    echo "$dryrun_output"
  fi

  echo "✓ Dry-run passed for $COMPOSE_FILE"
  
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
  echo "$summary" | write_artifact "$artifact_dir" "dry-run.json"
  echo "$summary"
  
  exit 0
}

main "$@"
