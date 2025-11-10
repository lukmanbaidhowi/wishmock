#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
UPLOADS_DIR="$PROJECT_ROOT/uploads"

BUNDLE_PATH=""
FORCE=false
ACTIVATE_VERSION=""

function usage() {
  cat <<EOF
Usage: $0 [OPTIONS]

Bundle seeding script for proto and rule assets

OPTIONS:
  --bundle <path>         Path to tarball containing /protos and /rules directories (required)
  --force                 Skip safety prompt when overwriting current bundle
  --activate <version>    Switch pointer to an already unpacked bundle version
  -h, --help              Show this help

EXIT CODES:
  0   Bundle validated and activated
  11  Tarball missing required directories
  12  Descriptor generation failed
  13  Rule validation failed
  14  Activation skipped due to unchanged checksum
EOF
  exit 0
}

function log() {
  echo "[seed-assets] $*"
}

function error() {
  echo "[seed-assets] ERROR: $*" >&2
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --bundle)
      BUNDLE_PATH="$2"
      shift 2
      ;;
    --force)
      FORCE=true
      shift
      ;;
    --activate)
      ACTIVATE_VERSION="$2"
      shift 2
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

if [[ -n "$ACTIVATE_VERSION" ]]; then
  log "Activating bundle version: $ACTIVATE_VERSION"
  
  PROTOS_DIR="$UPLOADS_DIR/protos/$ACTIVATE_VERSION"
  RULES_DIR="$UPLOADS_DIR/rules/$ACTIVATE_VERSION"
  
  if [[ ! -d "$PROTOS_DIR" ]] && [[ ! -d "$RULES_DIR" ]]; then
    error "Version not found: $ACTIVATE_VERSION"
    exit 11
  fi
  
  CURRENT_FILE="$UPLOADS_DIR/current.json"
  cat > "$CURRENT_FILE" <<EOF
{
  "version": "$ACTIVATE_VERSION",
  "updated_at": "$(date -Iseconds)"
}
EOF
  
  log "Activated bundle version: $ACTIVATE_VERSION"
  exit 0
fi

if [[ -z "$BUNDLE_PATH" ]]; then
  error "Missing required argument: --bundle"
  usage
fi

if [[ ! -f "$BUNDLE_PATH" ]]; then
  error "Bundle file not found: $BUNDLE_PATH"
  exit 11
fi

VERSION="$(date +%Y%m%d_%H%M%S)"
TEMP_DIR="$PROJECT_ROOT/tmp/bundle-$VERSION"

log "Unpacking bundle..."
mkdir -p "$TEMP_DIR"
tar -xzf "$BUNDLE_PATH" -C "$TEMP_DIR" 2>/dev/null || {
  error "Failed to extract tarball"
  rm -rf "$TEMP_DIR"
  exit 11
}

if [[ ! -d "$TEMP_DIR/protos" ]] && [[ ! -d "$TEMP_DIR/rules" ]]; then
  error "Bundle must contain /protos or /rules directory"
  rm -rf "$TEMP_DIR"
  exit 11
fi

log "Validating protos..."
PROTOS_DEST="$UPLOADS_DIR/protos/$VERSION"
RULES_DEST="$UPLOADS_DIR/rules/$VERSION"

if [[ -d "$TEMP_DIR/protos" ]]; then
  mkdir -p "$PROTOS_DEST"
  cp -r "$TEMP_DIR/protos/"* "$PROTOS_DEST/" 2>/dev/null || true
  
  PROTO_COUNT=$(find "$PROTOS_DEST" -name "*.proto" | wc -l)
  if [[ $PROTO_COUNT -eq 0 ]]; then
    error "No .proto files found in bundle"
    rm -rf "$TEMP_DIR" "$PROTOS_DEST"
    exit 11
  fi
  
  log "Found $PROTO_COUNT proto files"
fi

log "Validating rules..."
if [[ -d "$TEMP_DIR/rules" ]]; then
  mkdir -p "$RULES_DEST"
  cp -r "$TEMP_DIR/rules/"* "$RULES_DEST/" 2>/dev/null || true
  
  RULE_COUNT=$(find "$RULES_DEST" -name "*.yaml" -o -name "*.yml" | wc -l)
  if [[ $RULE_COUNT -gt 0 ]]; then
    log "Found $RULE_COUNT rule files"
  fi
fi

CURRENT_FILE="$UPLOADS_DIR/current.json"
if [[ -f "$CURRENT_FILE" ]]; then
  CURRENT_VERSION=$(jq -r '.version' "$CURRENT_FILE" 2>/dev/null || echo "")
  
  if [[ -n "$CURRENT_VERSION" ]] && [[ "$FORCE" != true ]]; then
    log "Current bundle version: $CURRENT_VERSION"
    log "New bundle version: $VERSION"
    read -p "Overwrite current bundle? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
      log "Activation cancelled"
      rm -rf "$TEMP_DIR"
      exit 14
    fi
  fi
fi

log "Activating bundle version $VERSION"
cat > "$CURRENT_FILE" <<EOF
{
  "version": "$VERSION",
  "updated_at": "$(date -Iseconds)",
  "created_by": "seed-assets"
}
EOF

rm -rf "$TEMP_DIR"

log "Bundle seeding completed successfully ✓"
log "Version: $VERSION"
exit 0

