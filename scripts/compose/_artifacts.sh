#!/usr/bin/env bash

ARTIFACTS_BASE_DIR="${ARTIFACTS_BASE_DIR:-artifacts/compose}"

create_artifact_dir() {
  local timestamp
  timestamp=$(date +%Y%m%d_%H%M%S)
  
  local artifact_dir="${ARTIFACTS_BASE_DIR}/${timestamp}"
  
  if ! mkdir -p "$artifact_dir"; then
    echo "ERROR: Failed to create artifact directory: $artifact_dir" >&2
    return 1
  fi
  
  echo "$artifact_dir"
  return 0
}

ensure_artifacts_base() {
  if ! mkdir -p "$ARTIFACTS_BASE_DIR"; then
    echo "ERROR: Failed to create artifacts base directory: $ARTIFACTS_BASE_DIR" >&2
    return 1
  fi
  return 0
}

write_artifact() {
  local artifact_dir="$1"
  local filename="$2"
  local content="${3:-}"
  
  if [[ -z "$artifact_dir" || -z "$filename" ]]; then
    echo "ERROR: write_artifact requires artifact_dir and filename" >&2
    return 1
  fi
  
  local filepath="${artifact_dir}/${filename}"
  
  if [[ -n "$content" ]]; then
    echo "$content" > "$filepath"
  else
    cat > "$filepath"
  fi
  
  return $?
}

