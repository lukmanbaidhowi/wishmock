#!/usr/bin/env bash
set -euo pipefail

# Generate a FileDescriptorSet using protoc. Main protos come from protobufjs's
# loader (mirrors runtime), while dependencies from subdirectories are included
# wholesale so imports are always available for reflection.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROTOS_DIR="$PROJECT_ROOT/protos"
OUTPUT_FILE="$PROJECT_ROOT/bin/.descriptors.bin"

echo "[generate-descriptor-set] Generating descriptor set..."

if ! command -v protoc >/dev/null 2>&1; then
  echo "[generate-descriptor-set] ERROR: protoc not found in PATH"
  exit 1
fi

mkdir -p "$(dirname "$OUTPUT_FILE")"

echo "[generate-descriptor-set] Detecting main protos (protobufjs)..."
# Prefer Node if available; otherwise use Bun; if the helper script is missing
# or the runtime is unavailable, fall back to all top-level protos.
HELPER="$SCRIPT_DIR/get-loadable-protos.mjs"
JS_RUNNER=""
if command -v node >/dev/null 2>&1; then JS_RUNNER="node"; elif command -v bun >/dev/null 2>&1; then JS_RUNNER="bun"; fi
if [ -n "$JS_RUNNER" ] && [ -f "$HELPER" ]; then
  LOADABLE_FILES=$($JS_RUNNER "$HELPER" 2>/dev/null | head -1 || true)
else
  LOADABLE_FILES=""
fi

# Fallback: use all top-level .proto files
if [ -z "$LOADABLE_FILES" ]; then
  echo "[generate-descriptor-set] Helper unavailable; using all top-level protos"
  LOADABLE_FILES=""
  for f in "$PROTOS_DIR"/*.proto; do
    [ -f "$f" ] || continue
    base="$(basename "$f")"
    LOADABLE_FILES="$LOADABLE_FILES $base"
  done
fi
if [ -z "$LOADABLE_FILES" ]; then
  echo "[generate-descriptor-set] ERROR: No top-level proto files loadable by protobufjs"
  exit 1
fi

read -r -a MAIN_NAMES <<<"$LOADABLE_FILES"
declare -a MAIN_PATHS=()
for name in "${MAIN_NAMES[@]}"; do
  MAIN_PATHS+=("$PROTOS_DIR/$name")
done

echo "[generate-descriptor-set] Including ${#MAIN_PATHS[@]} main proto files"

declare -a IMPORT_PATHS=()
while IFS= read -r -d '' file; do
  IMPORT_PATHS+=("$file")
done < <(find "$PROTOS_DIR" -mindepth 2 -type f -name "*.proto" -print0)

echo "[generate-descriptor-set] Including ${#IMPORT_PATHS[@]} import proto files from subdirectories"

declare -A UNIQUE=()
declare -a PROTO_FILES=()

add_proto() {
  local path="$1"
  [ -f "$path" ] || return 0
  if [[ -z "${UNIQUE[$path]+x}" ]]; then
    UNIQUE[$path]=1
    PROTO_FILES+=("$path")
  fi
}

for proto in "${MAIN_PATHS[@]}" "${IMPORT_PATHS[@]}"; do
  add_proto "$proto"
done

if [ ${#PROTO_FILES[@]} -eq 0 ]; then
  echo "[generate-descriptor-set] ERROR: No proto files selected"
  exit 1
fi

TOTAL_COUNT=${#PROTO_FILES[@]}
PROTO_PREFIX="$PROTOS_DIR/"
echo "[generate-descriptor-set] Total protos to compile: $TOTAL_COUNT"

echo "[generate-descriptor-set] Compiling descriptor set with protoc (bulk mode)..."
if protoc \
  --proto_path="$PROTOS_DIR" \
  --descriptor_set_out="$OUTPUT_FILE" \
  --include_imports \
  --include_source_info \
  "${PROTO_FILES[@]}"; then
  BULK_SUCCESS=true
else
  BULK_SUCCESS=false
fi

if [ "$BULK_SUCCESS" = false ]; then
  echo "[generate-descriptor-set] Bulk compilation failed, retrying per file..."
  TMP_DIR="$(mktemp -d)"
  SUCCESS_FILES=()
  LOADED=0
  SKIPPED=0
  for proto in "${PROTO_FILES[@]}"; do
    REL_PATH="$proto"
    if [[ "$REL_PATH" == "$PROTO_PREFIX"* ]]; then
      REL_PATH="${REL_PATH:${#PROTO_PREFIX}}"
    fi
    OUT_PATH="$TMP_DIR/${REL_PATH//\//_}.bin"
    if protoc \
      --proto_path="$PROTOS_DIR" \
      --descriptor_set_out="$OUT_PATH" \
      --include_imports \
      --include_source_info \
      "$proto"; then
      SUCCESS_FILES+=("$OUT_PATH")
      LOADED=$((LOADED + 1))
    else
      echo "[generate-descriptor-set] Skipped $REL_PATH (protoc error)"
      rm -f "$OUT_PATH"
      SKIPPED=$((SKIPPED + 1))
    fi
  done

  if [ $LOADED -eq 0 ]; then
    echo "[generate-descriptor-set] ERROR: protoc failed for all selected protos"
    rm -rf "$TMP_DIR"
    exit 1
  fi

  echo "[generate-descriptor-set] Merging $LOADED descriptor fragments (skipped $SKIPPED)"
  cat "${SUCCESS_FILES[@]}" >"$OUTPUT_FILE"
  rm -rf "$TMP_DIR"
  echo "[generate-descriptor-set] Included $LOADED proto files (of $TOTAL_COUNT)"
else
  echo "[generate-descriptor-set] Bulk compilation succeeded"
  echo "[generate-descriptor-set] Included $TOTAL_COUNT proto files"
fi

if [ -f "$OUTPUT_FILE" ]; then
  SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
  echo "[generate-descriptor-set] ✓ Generated $OUTPUT_FILE ($SIZE)"
else
  echo "[generate-descriptor-set] ERROR: Failed to generate descriptor set"
  exit 1
fi
