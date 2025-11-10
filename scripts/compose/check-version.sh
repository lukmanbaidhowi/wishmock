#!/usr/bin/env bash
set -euo pipefail

REQUIRED_VERSION="2.24"

check_compose_version() {
  if ! command -v docker &>/dev/null; then
    echo "ERROR: docker command not found" >&2
    return 1
  fi

  if ! docker compose version &>/dev/null; then
    echo "ERROR: docker compose plugin not available" >&2
    return 1
  fi

  local version_output
  version_output=$(docker compose version 2>&1)
  
  local version_number
  version_number=$(echo "$version_output" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n1)

  if [[ -z "$version_number" ]]; then
    echo "ERROR: Could not parse Docker Compose version from: $version_output" >&2
    return 1
  fi

  local major_minor
  major_minor=$(echo "$version_number" | cut -d. -f1,2)

  if [[ "$major_minor" != "$REQUIRED_VERSION" ]]; then
    echo "ERROR: Docker Compose version $REQUIRED_VERSION.x required, found $version_number" >&2
    echo "Please install Docker Compose plugin version $REQUIRED_VERSION.x" >&2
    return 1
  fi

  echo "Docker Compose version $version_number (OK)"
  return 0
}

check_compose_version

