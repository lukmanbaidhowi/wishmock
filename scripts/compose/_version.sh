#!/usr/bin/env bash

REQUIRED_COMPOSE_VERSION="2.24"

guard_compose_version() {
  if ! command -v docker &>/dev/null; then
    echo "ERROR: docker command not found" >&2
    echo "Please install Docker Engine" >&2
    return 1
  fi

  if ! docker compose version &>/dev/null; then
    echo "ERROR: docker compose plugin not available" >&2
    echo "Please install Docker Compose plugin version $REQUIRED_COMPOSE_VERSION.x" >&2
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

  local required_major required_minor
  required_major=$(echo "$REQUIRED_COMPOSE_VERSION" | cut -d. -f1)
  required_minor=$(echo "$REQUIRED_COMPOSE_VERSION" | cut -d. -f2)
  
  local actual_major actual_minor
  actual_major=$(echo "$major_minor" | cut -d. -f1)
  actual_minor=$(echo "$major_minor" | cut -d. -f2)

  if [[ "$actual_major" -lt "$required_major" ]] || \
     [[ "$actual_major" -eq "$required_major" && "$actual_minor" -lt "$required_minor" ]]; then
    echo "ERROR: Docker Compose version $REQUIRED_COMPOSE_VERSION.x or higher required, found $version_number" >&2
    echo "Please install or upgrade to Docker Compose plugin version $REQUIRED_COMPOSE_VERSION.x or higher" >&2
    return 1
  fi

  return 0
}

