#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
DST="$ROOT_DIR/protos"

mkdir -p \
  "$DST/google/api" \
  "$DST/google/type" \
  "$DST/google/rpc" \
  "$DST/google/longrunning" \
  "$DST/google/protobuf" \
  "$DST/validate" \
  "$DST/opentelemetry/proto/common/v1" \
  "$DST/opentelemetry/proto/resource/v1" \
  "$DST/opentelemetry/proto/trace/v1" \
  "$DST/opentelemetry/proto/metrics/v1" \
  "$DST/opentelemetry/proto/logs/v1" \
  "$DST/envoy" \
  "$DST/protoc-gen-openapiv2/options" \
  "$DST/protoc-gen-doc/options"

fetch() {
  local out="$1" url="$2"
  echo "-> $out"
  curl -fsSL -o "$out" "$url"
}

echo "Fetching Google API protos..."
fetch "$DST/google/api/annotations.proto" https://raw.githubusercontent.com/googleapis/googleapis/master/google/api/annotations.proto
fetch "$DST/google/api/http.proto"         https://raw.githubusercontent.com/googleapis/googleapis/master/google/api/http.proto
fetch "$DST/google/api/client.proto"       https://raw.githubusercontent.com/googleapis/googleapis/master/google/api/client.proto
fetch "$DST/google/api/resource.proto"     https://raw.githubusercontent.com/googleapis/googleapis/master/google/api/resource.proto

echo "Fetching google/type protos (best-effort set)..."
for f in color date datetime expr interval latlng money phone_number postal_address timeofday; do
  url="https://raw.githubusercontent.com/googleapis/googleapis/master/google/type/${f}.proto"
  out="$DST/google/type/${f}.proto"
  if ! curl -fsSL -o "$out" "$url"; then
    echo "(skip) $out not found at upstream"
  else
    echo "-> $out"
  fi
done

echo "Fetching google/rpc protos..."
# Try to fetch a common set; skip gracefully if not found at the path
for f in \
  code.proto \
  status.proto \
  error_details.proto \
  retry_info.proto \
  debug_info.proto \
  quota_failure.proto \
  bad_request.proto \
  request_info.proto \
  resource_info.proto \
  help.proto \
  localized_message.proto \
  precondition_failure.proto; do
  out="$DST/google/rpc/${f}"
  url_master="https://raw.githubusercontent.com/googleapis/googleapis/master/google/rpc/${f}"
  url_main="https://raw.githubusercontent.com/googleapis/googleapis/main/google/rpc/${f}"
  if curl -fsSL -o "$out" "$url_master"; then
    echo "-> $out (master)"
  elif curl -fsSL -o "$out" "$url_main"; then
    echo "-> $out (main)"
  else
    echo "(skip) $out not found at upstream"
  fi
done

echo "Fetching Google Long Running Operations (LRO) protos..."
fetch "$DST/google/longrunning/operations.proto" \
  https://raw.githubusercontent.com/googleapis/googleapis/master/google/longrunning/operations.proto

echo "Fetching google/protobuf well-known types (incl. descriptor)..."
PROTOBUF_BASE=https://raw.githubusercontent.com/protocolbuffers/protobuf/main/src/google/protobuf
for f in \
  any.proto \
  api.proto \
  descriptor.proto \
  duration.proto \
  empty.proto \
  field_mask.proto \
  source_context.proto \
  struct.proto \
  timestamp.proto \
  type.proto \
  wrappers.proto; do
  fetch "$DST/google/protobuf/$f" "$PROTOBUF_BASE/$f"
done

echo "Fetching protoc-gen-validate proto..."
PGV_TAG=v1.0.4
fetch "$DST/validate/validate.proto" \
  https://raw.githubusercontent.com/bufbuild/protoc-gen-validate/$PGV_TAG/validate/validate.proto

echo "Fetching OpenTelemetry protos (core subsets)..."
OTEL_TAG=v1.1.0
fetch "$DST/opentelemetry/proto/common/v1/common.proto"   https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/$OTEL_TAG/opentelemetry/proto/common/v1/common.proto
fetch "$DST/opentelemetry/proto/resource/v1/resource.proto" https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/$OTEL_TAG/opentelemetry/proto/resource/v1/resource.proto
fetch "$DST/opentelemetry/proto/trace/v1/trace.proto"     https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/$OTEL_TAG/opentelemetry/proto/trace/v1/trace.proto
fetch "$DST/opentelemetry/proto/metrics/v1/metrics.proto" https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/$OTEL_TAG/opentelemetry/proto/metrics/v1/metrics.proto
fetch "$DST/opentelemetry/proto/logs/v1/logs.proto"       https://raw.githubusercontent.com/open-telemetry/opentelemetry-proto/$OTEL_TAG/opentelemetry/proto/logs/v1/logs.proto

echo "Fetching grpc-gateway OpenAPI annotation protos..."
GW_TAG=v2.22.0
fetch "$DST/protoc-gen-openapiv2/options/annotations.proto" https://raw.githubusercontent.com/grpc-ecosystem/grpc-gateway/$GW_TAG/protoc-gen-openapiv2/options/annotations.proto
fetch "$DST/protoc-gen-openapiv2/options/openapiv2.proto"   https://raw.githubusercontent.com/grpc-ecosystem/grpc-gateway/$GW_TAG/protoc-gen-openapiv2/options/openapiv2.proto

echo "Fetching protoc-gen-doc annotations proto..."
PGD_TAG=v1.5.1
# Known possible upstream locations
PGD_CANDIDATES=(
  "protoc-gen-doc/options/annotations.proto"
  "proto/protoc-gen-doc/options/annotations.proto"
)

PGD_FETCHED=false
for rel in "${PGD_CANDIDATES[@]}"; do
  url_tag="https://raw.githubusercontent.com/pseudomuto/protoc-gen-doc/$PGD_TAG/$rel"
  url_master="https://raw.githubusercontent.com/pseudomuto/protoc-gen-doc/master/$rel"
  out="$DST/$rel"
  mkdir -p "$(dirname "$out")"
  if curl -fsSL -o "$out" "$url_tag"; then
    echo "-> $out (tag $PGD_TAG)"
    PGD_FETCHED=true
    break
  fi
  echo "(warn) $rel not found at tag $PGD_TAG; trying master"
  if curl -fsSL -o "$out" "$url_master"; then
    echo "-> $out (master)"
    PGD_FETCHED=true
    break
  fi
done

if [ "$PGD_FETCHED" != true ]; then
  echo "(warn) Skipping protoc-gen-doc annotations; not found at known paths" >&2
fi

cat <<'NOTE'

Note on Envoy API protos:
- The Envoy data-plane API is large with many transitive imports.
- To avoid pulling hundreds of files by default, this script skips Envoy.
- If you need specific Envoy protos, add fetch() calls below with concrete paths
  from https://github.com/envoyproxy/data-plane-api (or the mirrored paths in
  the Envoy repo) and any of their dependencies.

Examples (disabled):
# ENVOY_TAG=v1.30.0
# fetch "$DST/envoy/config/route/v3/route.proto" \
#   https://raw.githubusercontent.com/envoyproxy/data-plane-api/$ENVOY_TAG/envoy/config/route/v3/route.proto

NOTE

echo "Done. Third-party protos downloaded into protos/."
