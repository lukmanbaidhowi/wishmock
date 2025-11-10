#!/usr/bin/env bash
set -euo pipefail

# Helper for building and running the Node-based Docker Compose stack
# using node-docker-compose.yaml in this repo.

COMPOSE_FILE="node-docker-compose.yaml"
SERVICE="wishmock-cluster"

action="${1:-}"
shift || true

dc() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

case "$action" in
  lint)
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    exec "${SCRIPT_DIR}/compose/lint.sh" --file "$COMPOSE_FILE" "$@"
    ;;
  build)
    dc build "$@"
    ;;
  up)
    # Default: up in detached mode and build if needed
    dc up -d --build "$@"
    ;;
  down)
    dc down "$@"
    ;;
  restart)
    dc up -d --build "$@"
    ;;
  logs)
    dc logs -f "$SERVICE" "$@"
    ;;
  ps)
    dc ps "$@"
    ;;
  stop)
    dc stop "$@"
    ;;
  rm)
    dc rm -f "$@"
    ;;
  *)
    cat <<EOF
Usage: $(basename "$0") <command> [args]

Commands:
  lint            Validate compose file syntax
  build           Build image(s)
  up              Start (detached) and build if needed
  down            Stop and remove containers/network
  restart         Rebuild and restart
  logs            Tail service logs (default: $SERVICE)
  ps              List containers
  stop            Stop containers
  rm              Remove stopped containers

Examples:
  $(basename "$0") lint
  $(basename "$0") build
  $(basename "$0") up
  $(basename "$0") logs
EOF
    ;;
esac

