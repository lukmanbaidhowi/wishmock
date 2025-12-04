# gRPC Reflection with Protoc Descriptor Generation

## Overview

The server uses `protoc`-generated descriptor sets to provide accurate gRPC reflection for complex protobuf types including maps, Well-Known Types (WKT), and validation annotations.

## Why Protoc Descriptors?

**Problem**: The default approach using `@grpc/proto-loader` + `protobufjs` sometimes generates descriptors that don't exactly match `protoc`'s output, particularly for:
- Map fields (implicit map entry descriptors)
- Well-Known Types (Timestamp, Duration, Any, Struct)
- Proto files with validation annotations

This causes tools like `grpcurl` to fail with "malformed descriptor" errors when using server reflection.

**Solution**: Generate descriptor sets using `protoc --descriptor_set_out` at build time, ensuring 100% compatibility with the official protobuf protocol.

## Architecture

```
┌─────────────────────┐
│   Proto Files       │
│   (protos/*.proto)  │
└──────────┬──────────┘
           │
           ├─── Build Time ───┐
           │                  │
           v                  v
   ┌───────────────┐   ┌──────────────────┐
   │  protoc       │   │  protobufjs      │
   │  (official)   │   │  (runtime parse) │
   └───────┬───────┘   └─────────┬────────┘
           │                     │
           v                     v
   ┌──────────────────────┐   ┌─────────────────┐
   │ bin/.descriptors.bin │   │ Runtime Schema  │
   │ (reflection)         │   │ (validation/    │
   │                      │   │  handlers)      │
   └──────────┬───────────┘   └─────────┬───────┘
             │                      │
             └──────────┬───────────┘
                        │
                        v
              ┌──────────────────┐
              │  gRPC Server     │
              │  + Reflection    │
              └──────────────────┘
```

## Implementation

### 1. Descriptor Generation Script

Location: `scripts/generate-descriptor-set.sh`

**Design:** Blend of runtime-aware discovery and full dependency coverage.

1. Ask `protobufjs` (via `scripts/get-loadable-protos.mjs`) which *top-level* files load cleanly using the same options as `protoLoader.ts`. These are treated as the "main" protos that define services we actually serve.
2. Recursively gather **all** `.proto` files that live in subdirectories (`google/`, `buf/`, `validate/`, etc.). These are pulled in wholesale so imports such as `google/api/field_behavior.proto` and well-known types are always available to reflection.
3. Merge and deduplicate the two sets, then feed them to `protoc` with `--include_imports` and `--include_source_info`.
4. If bulk compilation fails, fall back to per-file compilation, skip the failures, and concatenate the successes. The script ensures at least the main protos succeed before producing the final descriptor set.

**Key features:**
- **Runtime parity for services**: Main files come straight from protobufjs' load result, so reflection sees exactly what the running server exposes.
- **Full dependency coverage**: Subdirectories are always included, preventing missing descriptors for annotations like `google.api.field_behavior` or `validate.validate`.
- **Two-phase compilation**: Uses bulk `protoc` when possible; otherwise retries each file individually and merges the successes.
- **Helpful logging**: For skipped files the script prints the failing import so missing vendor protos can be added explicitly.

> **Tip:** When a new google API import shows up (for example, `google/api/launch_stage.proto`), vendor the file into `protos/google/api/` so the descriptor build keeps succeeding without requiring extra import paths at runtime.

**protoc flags:**
- `--include_imports`: Include all transitive dependencies (google/*, buf/*, etc.)
- `--include_source_info`: Preserve comments and metadata
- `--descriptor_set_out`: Output single binary file

### 2. Reflection Integration

Location: `src/infrastructure/reflection.ts`

```typescript
function loadProtocDescriptorSet(): Buffer[] {
  const descriptorPath = path.join(process.cwd(), 'bin/.descriptors.bin');
  if (fs.existsSync(descriptorPath)) {
    const fileDescriptorSetBuf = fs.readFileSync(descriptorPath);
    
    // Parse FileDescriptorSet wire format
    // Extract individual FileDescriptorProto messages
    // Return as Buffer array for reflection service
  }
  return [];
}

// Seed reflection with protoc descriptors
const protocDescriptors = loadProtocDescriptorSet();
for (const buf of protocDescriptors) {
  fileDescriptorSet.add(Buffer.from(buf).toString("base64"));
}
```

#### WKT Preservation
Consolidated vendor descriptor files (for example, `google_protobuf.proto`) are left intact — all Well‑Known Types and enums are preserved. We only normalize the package to `google.protobuf` when necessary. Filtering message/enums here can remove types like `Empty`, `Struct`, `Value`, `ListValue`, wrapper types, or `FieldMask`, which breaks reflection clients.

### 3. Hot Reload Integration

Location: `src/app.ts`

```typescript
async function regenerateDescriptors() {
  const descriptorPath = path.resolve('bin/.descriptors.bin');
  
  // Optimization: Skip if up-to-date
  if (fs.existsSync(descriptorPath)) {
    const descriptorTime = fs.statSync(descriptorPath).mtimeMs;
    const protoFiles = fs.readdirSync(PROTO_DIR)
      .filter(f => f.endsWith('.proto'))
      .map(f => path.join(PROTO_DIR, f));
    
    const hasNewerProto = protoFiles.some(f => 
      fs.statSync(f).mtimeMs > descriptorTime
    );
    
    if (!hasNewerProto) {
      log("✓ Reflection descriptor up-to-date");
      return; // Skip regeneration
    }
  }
  
  log("Regenerating reflection descriptors...");
  execSync(`bash "${scriptPath}"`, { stdio: 'pipe' });
  log("✓ Reflection descriptors regenerated");
}

async function rebuild(reason: string) {
  await regenerateDescriptors(); // ← Auto-regenerate
  // ... load protos, start server
}
```

**Triggers:**
1. **Initial boot**: `rebuild("boot")` → regenerate if needed
2. **Proto file changed**: File watcher → `rebuild(".proto changed")` → regenerate if needed
3. **Docker build**: Pre-generated in Dockerfile

### 4. Docker Integration

Location: `Dockerfile`

```dockerfile
# Build stage
FROM oven/bun:1.2.20-alpine AS builder
COPY protos ./protos
COPY scripts ./scripts

# Install protoc
RUN apk add --no-cache protobuf

# Build + generate descriptors
RUN bun run build && bun run descriptors:generate

# Runtime stage
FROM oven/bun:1.2.20-alpine AS runner

# Copy pre-generated descriptor
COPY --from=builder /app/bin/.descriptors.bin ./bin/.descriptors.bin

# Keep protoc for hot-reload
RUN apk add --no-cache protobuf
```

## Performance

### Build Time
- Descriptor generation: ~1-2 seconds for ~50 proto files
- Added to build process (parallel with TypeScript compilation)
- One-time cost per build

### Runtime
- **Container startup**: Instant (descriptors pre-baked)
- **Hot reload**: 1-2 seconds (regenerate + restart)
- **Optimization**: Mtime-based skip for unchanged protos

### Benchmarks

| Scenario | Without Optimization | With Optimization |
|----------|---------------------|-------------------|
| Container first boot | 1-2s (regenerate) | Instant ⚡ (skip) |
| Container restart | 1-2s (regenerate) | Instant ⚡ (skip) |
| Proto upload | 1-2s (regenerate) | 1-2s (regenerate) |
| Proto unchanged | 1-2s (regenerate) | Instant ⚡ (skip) |

## Usage

### Development

```bash
# Generate descriptors manually
bun run descriptors:generate

# Start with auto-regeneration
bun run start  # prestart hook generates descriptors

# Or direct start (will generate on boot if needed)
bun dist/app.js
```

### Docker

```bash
# Build image (descriptors generated automatically)
docker build -t wishmock:latest .

# Run container (descriptors pre-baked)
docker run -p 50050:50050 wishmock:latest

# Upload proto → automatic descriptor regeneration
curl -X PUT http://localhost:4319/api/protos/my_service.proto \
  -H "Content-Type: application/json" \
  -d '{"content":"syntax = \"proto3\"; ..."}'
```

### Testing Reflection

```bash
# List services (no -proto flag needed!)
grpcurl -plaintext localhost:50050 list

# Describe service with map/WKT fields
grpcurl -plaintext localhost:50050 describe validation.ValidationService

# Call method with map field
grpcurl -plaintext -d '{"labels":{"k1":"v1"}}' \
  localhost:50050 validation.ValidationService/ValidateMap

# Call method with Timestamp
grpcurl -plaintext -d '{"ts":"2024-01-01T00:00:00Z"}' \
  localhost:50050 validation.ValidationService/ValidateTimestamp
```

## Troubleshooting

### Descriptor Not Found

```
[wishmock] (warn) Descriptor generation script not found
```

**Solution**: Ensure `scripts/generate-descriptor-set.sh` exists and is executable:
```bash
chmod +x scripts/generate-descriptor-set.sh
```

### Protoc Not Available

```
[wishmock] Failed to regenerate descriptors: protoc: command not found
```

**Solution**: Install protobuf compiler:
```bash
# macOS
brew install protobuf

# Ubuntu/Debian
apt-get install -y protobuf-compiler

# Alpine (Docker)
apk add --no-cache protobuf
```

### Descriptor Out of Sync

If reflection shows stale service definitions after proto changes:

```bash
# Force regeneration
rm bin/.descriptors.bin
bun run descriptors:generate

# Or restart server (will auto-regenerate)
```

## Files Modified

### New Files
- `scripts/generate-descriptor-set.sh` - Descriptor generation script
- `bin/.descriptors.bin` - Generated descriptor set (gitignored)
- `docker-build-test.sh` - Docker build verification script

### Modified Files
- `src/infrastructure/reflection.ts` - Load protoc descriptors
- `src/app.ts` - Hot-reload integration with mtime optimization
- `Dockerfile` - Install protoc, generate descriptors
- `.dockerignore` - Allow scripts directory
- `package.json` - Add `descriptors:generate` script
- E2E test scripts - Remove `-import-path` workarounds

## References

- [gRPC Server Reflection Protocol](https://github.com/grpc/grpc/blob/master/doc/server-reflection.md)
- [Protobuf Descriptor](https://protobuf.dev/reference/cpp/api-docs/google.protobuf.descriptor/)
- [grpcurl Documentation](https://github.com/fullstorydev/grpcurl)
- [Buf Protovalidate](https://github.com/bufbuild/protovalidate)
