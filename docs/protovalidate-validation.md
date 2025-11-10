# Protovalidate Validation Support

This mock gRPC server now supports **Protovalidate** (formerly PGV v2) validation in addition to PGV (Protoc Gen Validate).

Enable with env:
- `VALIDATION_ENABLED=true`
- `VALIDATION_SOURCE=protovalidate` (Protovalidate-only) or `auto` (Protovalidate preferred, PGV fallback)
- Optional: `VALIDATION_MODE=per_message|aggregate` (default `per_message`)

Note: The `buf/validate/validate.proto` used by the server is fetched directly from the official Buf Protovalidate repository and pinned to a release tag for determinism. Run `bun run protos:fetch` to update vendor protos (see `scripts/fetch-third-party-protos.sh`, pinned to `v1.0.0`).

## Overview

Protovalidate allows you to define validation rules directly in your `.proto` files using the `buf.validate.field` extension. The validation engine automatically extracts and enforces these rules at runtime.

## Quick Start

### 1. Import Buf Validation Proto

```protobuf
import "buf/validate/validate.proto";
```

### 2. Add Validation Annotations

Add validation constraints to your message fields (official option names):

```protobuf
message User {
  string first_name = 1 [
    (buf.validate.field).string = { min_len: 1, max_len: 50 }
  ];

  string email = 2 [
    (buf.validate.field).string = { email: true }
  ];

  int32 age = 3 [
    (buf.validate.field).int32 = { gte: 0, lte: 150 }
  ];

  repeated string tags = 4 [
    (buf.validate.field).repeated = { min_items: 1, max_items: 10 }
  ];
}
```

## Constraint Coverage Table

The following table shows all implemented Protovalidate constraints with their validation status:

| Constraint ID | Category | Status | Valid Example | Invalid Example | Doc Anchor |
|--------------|----------|--------|---------------|-----------------|------------|
| `string.min_len` | string | ✅ Implemented | `"hello"` (min=3) | `"hi"` (min=3) | [#string-constraints](#string-constraints-string) |
| `string.max_len` | string | ✅ Implemented | `"hi"` (max=10) | `"very long text"` (max=5) | [#string-constraints](#string-constraints-string) |
| `string.email` | string | ✅ Implemented | `"user@example.com"` | `"invalid"` | [#string-constraints](#string-constraints-string) |
| `string.pattern` | string | ✅ Implemented | `"ABC123"` (^[A-Z0-9]+$) | `"abc"` (^[A-Z0-9]+$) | [#string-constraints](#string-constraints-string) |
| `string.prefix` | string | ✅ Implemented | `"prefix_value"` (prefix="prefix_") | `"value"` (prefix="prefix_") | [#string-constraints](#string-constraints-string) |
| `string.suffix` | string | ✅ Implemented | `"value_suffix"` (suffix="_suffix") | `"value"` (suffix="_suffix") | [#string-constraints](#string-constraints-string) |
| `string.contains` | string | ✅ Implemented | `"contains word"` (contains="word") | `"no match"` (contains="word") | [#string-constraints](#string-constraints-string) |
| `int32.gte` | number | ✅ Implemented | `18` (gte=18) | `17` (gte=18) | [#numeric-constraints-eg-int32-uint32-double](#numeric-constraints-eg-int32-uint32-double) |
| `int32.lte` | number | ✅ Implemented | `100` (lte=100) | `101` (lte=100) | [#numeric-constraints-eg-int32-uint32-double](#numeric-constraints-eg-int32-uint32-double) |
| `repeated.min_items` | repeated | ✅ Implemented | `["a","b"]` (min=1) | `[]` (min=1) | [#repeated-constraints-repeated](#repeated-constraints-repeated) |
| `repeated.max_items` | repeated | ✅ Implemented | `["a"]` (max=5) | `["a","b","c","d","e","f"]` (max=5) | [#repeated-constraints-repeated](#repeated-constraints-repeated) |
| `repeated.unique` | repeated | ✅ Implemented | `["a","b"]` | `["a","a"]` | [#repeated-constraints-repeated](#repeated-constraints-repeated) |
| `bytes.min_len` | bytes | ✅ Implemented | `"dGVzdA=="` (4 bytes, min=3) | `"dGU="` (2 bytes, min=3) | [#bytes-constraints-bytes](#bytes-constraints-bytes) |
| `bytes.max_len` | bytes | ✅ Implemented | `"dGU="` (2 bytes, max=5) | `"dGVzdGluZw=="` (7 bytes, max=5) | [#bytes-constraints-bytes](#bytes-constraints-bytes) |
| `bytes.pattern` | bytes | ✅ Implemented | `"test"` (^test$) | `"fail"` (^test$) | [#bytes-constraints-bytes](#bytes-constraints-bytes) |
| `bytes.ip` | bytes | ✅ Implemented | `"192.168.1.1"` | `"not-an-ip"` | [#bytes-constraints-bytes](#bytes-constraints-bytes) |
| `map.min_pairs` | map | ✅ Implemented | `{"a":"1","b":"2"}` (min=1) | `{}` (min=1) | [#map-constraints-mapkv](#map-constraints-mapkv) |
| `map.max_pairs` | map | ✅ Implemented | `{"a":"1"}` (max=5) | `{"a":"1","b":"2",...}` (10 pairs, max=5) | [#map-constraints-mapkv](#map-constraints-mapkv) |
| `timestamp.lt_now` | timestamp | ✅ Implemented | `"2020-01-01T00:00:00Z"` | `"2030-01-01T00:00:00Z"` | [#googleprotobuftimestamp](#googleprotobuftimestamp) |
| `timestamp.gt_now` | timestamp | ✅ Implemented | `"2030-01-01T00:00:00Z"` | `"2020-01-01T00:00:00Z"` | [#googleprotobuftimestamp](#googleprotobuftimestamp) |
| `timestamp.within` | timestamp | ✅ Implemented | now ± 30s (within=60s) | now ± 2min (within=60s) | [#googleprotobuftimestamp](#googleprotobuftimestamp) |
| `duration.const` | duration | ✅ Implemented | `"5s"` (const=5s) | `"10s"` (const=5s) | [#googleprotobufduration](#googleprotobufduration) |
| `duration.lt` | duration | ✅ Implemented | `"4s"` (lt=5s) | `"6s"` (lt=5s) | [#googleprotobufduration](#googleprotobufduration) |
| `any.in` | any | ✅ Implemented | type_url in allowed list | type_url not in list | [#googleprotobufany](#googleprotobufany) |
| `field.required` | message | ✅ Implemented | Field set | Field unset | [#field-presence-required](#field-presence-required) |
| `field.cel` | message | ✅ Implemented | Expression returns true | Expression returns false | [#cel-expression-validation](#cel-expression-validation) |
| `message.cel` | message | ✅ Implemented | Message-level expr true | Message-level expr false | [#cel-expression-validation](#cel-expression-validation) |
| `message.oneof` | message | ✅ Implemented | Valid oneof selection | Invalid oneof state | See [oneof-validation.md](./oneof-validation.md) |

**Legend:**
- ✅ Implemented: Full validator and E2E tests available
- ⚠️ Partial: Basic implementation, limited test coverage
- ❌ Not Implemented: Planned but not yet available

**Verification Checklist:**
- [x] All constraints have valid example payloads documented above
- [x] All constraints have invalid example payloads documented above
- [x] Unit tests exist for each constraint in `tests/validation.engine.test.ts`
- [x] E2E tests exist for bytes (`bun run validation:e2e:protovalidate:bytes`)
- [x] E2E tests exist for maps (`bun run validation:e2e:protovalidate:maps`)
- [x] E2E tests exist for WKT Timestamp/Duration (`bun run validation:e2e:protovalidate:wkt:timestamp-duration`)
- [x] E2E tests exist for WKT Any (`bun run validation:e2e:protovalidate:wkt:any`)
- [x] Admin API `/admin/status` exposes validation metrics
 - [x] Descriptor generation and reflection are documented in `docs/reflection-descriptor-generation.md`
- [x] Coverage table references specific test commands

## Supported Constraints

### String Constraints (`string`)

- `min_len: int32` - Minimum string length
- `max_len: int32` - Maximum string length
- `min_bytes: int32` - Minimum byte length (UTF-8)
- `max_bytes: int32` - Maximum byte length (UTF-8)
- `pattern: string` - Regex pattern to match
- `email: bool` - Must be valid email
- `hostname: bool` - Must be valid hostname
- `ipv4: bool` - Must be valid IPv4 address
- `ipv6: bool` - Must be valid IPv6 address
- `ip: bool` - Must be valid IPv4 or IPv6 address
- `uri: bool` - Must be valid URI
- `uuid: bool` - Must be valid UUID
- `prefix: string` - Must start with this prefix
- `suffix: string` - Must end with this suffix
- `contains: string` - Must contain this substring
- `not_contains: string` - Must not contain this substring

### Numeric Constraints (e.g., `int32`, `uint32`, `double`)

- `const: int64/double/uint64` - Value must equal this constant
- `gt: int64/double/uint64` - Greater than
- `gte: int64/double/uint64` - Greater than or equal
- `lt: int64/double/uint64` - Less than
- `lte: int64/double/uint64` - Less than or equal

### Repeated Constraints (`repeated`)

- `min_items: int32` - Minimum number of items
- `max_items: int32` - Maximum number of items
- `unique: bool` - All items must be unique

### Bytes Constraints (`bytes`)

- `len: int32` - Exact byte length
- `min_len: int32`, `max_len: int32` - Byte length bounds
- `const: bytes/string` - Exact value match (base64 or UTF-8 string)
- `pattern: string` - Regex match on UTF-8 representation
- `prefix`, `suffix`, `contains` (UTF-8 string semantics)
- `in`, `not_in` - Allowed/denied set (base64 or UTF-8 strings)
- `ip`, `ipv4`, `ipv6` - IP address checks on UTF-8 representation

### Map Constraints (`map<K,V>`)

- `min_pairs: int32`, `max_pairs: int32`
- Note: Nested key/value rules are not yet extracted; pair counts are enforced.

### Well-Known Types

#### `google.protobuf.Timestamp`
- `const`, `lt`, `lte`, `gt`, `gte`: compare against RFC3339 string or epoch millis
- `lt_now`, `gt_now`: relative to current time
- `within: duration` (e.g., `5m`, `2h`): absolute delta to now within given duration

#### `google.protobuf.Duration`
- `const`, `lt`, `lte`, `gt`, `gte`: compare against duration strings (e.g., `500ms`, `2s`, `1h`) or millis
- `within: duration`: require duration to be within bound

#### `google.protobuf.Any`
- `in: [type_url]`, `not_in: [type_url]` on the `type_url` field

### Field Presence (`required`)

- `(buf.validate.field).required = true` — for fields with presence, requires it to be set; for scalars, disallows zero value

## CEL Expression Validation

CEL (Common Expression Language) allows you to write custom validation logic using complex expressions that can reference multiple fields.

### Syntax

```protobuf
(buf.validate.field).cel = {
  expression: "your_cel_expression",
  message: "custom error message"
}
```

### Supported Operators

- **Comparison**: `==`, `!=`, `<`, `>`, `<=`, `>=`
- **Logical**: `&&`, `||`, `!`
- **Field Access**: Direct field references like `field_name`

### Examples

#### Age Validation

```protobuf
message User {
  int32 age = 1 [
    (buf.validate.field).cel = {
      expression: "age >= 18",
      message: "must be 18 years old"
    }
  ];
}
```

#### Range Validation

```protobuf
message PriceRange {
  double min_price = 1;
  double max_price = 2;
  
  // Validate that min < max using CEL on the message type
}
```

#### Complex Logic

```protobuf
message Account {
  string account_type = 1;
  double balance = 2;
  
  // Complex validation rules can be expressed as CEL
}
```

### Important Notes

- CEL expressions operate on the message context, giving access to all fields
- The expression must return a boolean value
- If expression evaluation fails, validation defaults to false (fails)
- Custom error messages make debugging easier for clients

## Examples

### Email Validation (string)

```protobuf
message SignupRequest {
  string email = 1 [
    (buf.validate.field).string = {
      email: true,
      max_len: 254
    }
  ];
}
```

### Numeric Range (int32)

```protobuf
message PaginationRequest {
  int32 page_size = 1 [
    (buf.validate.field).int32 = {
      gte: 1,
      lte: 100
    }
  ];
}
```

### List Validation (repeated)

```protobuf
message BatchRequest {
  repeated string ids = 1 [
    (buf.validate.field).repeated = {
      min_items: 1,
      max_items: 1000,
      unique: true
    }
  ];
}
```

## PGV vs Protovalidate

The validation engine supports both PGV and Protovalidate validation:

- Syntax
  - PGV: `(validate.rules)`
  - Protovalidate: `(buf.validate.field)`
- String rules
  - PGV: nested under `(validate.rules).string.*`
  - Protovalidate: `(buf.validate.field).string.*`
- Numeric rules
  - PGV: type-specific, e.g., `(validate.rules).int32.*`, `(validate.rules).double.*`
  - Protovalidate: type-specific, e.g., `(buf.validate.field).int32.*`, `(buf.validate.field).double.*`
- Repeated/Enum
  - PGV: `(validate.rules).repeated.*`, enums via `(validate.rules).enum.*`
  - Protovalidate: `(buf.validate.field).repeated.*`, `(buf.validate.field).enum.*`
- Status: Both supported

Source selection rules:
- With `VALIDATION_SOURCE=pgv`, only PGV rules are enforced; Protovalidate rules are ignored.
- With `VALIDATION_SOURCE=protovalidate`, only Protovalidate rules are enforced; PGV rules are ignored.
- With `VALIDATION_SOURCE=auto` (default), Protovalidate takes precedence; if no Protovalidate rule is present, PGV is used as fallback.

## Reflection Support

The server now provides full gRPC reflection support for services with map fields, WKT (Well-Known Types), and validation annotations. This allows tools like `grpcurl` to discover and call services without needing explicit `-proto` or `-import-path` flags.

### How It Works

1. **Descriptor Generation**: At build time, the server generates a complete descriptor set (`bin/.descriptors.bin`) using `protoc --descriptor_set_out`. This ensures map entries and WKT structures match the official protobuf protocol.

2. **Hot Reload**: When proto files change (via file upload or modification), the descriptor set is automatically regenerated before the server restarts.

3. **Reflection API**: The descriptor set is loaded into the gRPC reflection service, allowing complete service discovery.

### Usage Examples

```bash
# List all services (no -proto flag needed)
grpcurl -plaintext localhost:50050 list

# Describe a service with map/WKT fields
grpcurl -plaintext localhost:50050 describe validation.ValidationService

# Call validation methods directly via reflection
grpcurl -plaintext -d '{"labels":{"key":"value"}}' \
  localhost:50050 validation.ValidationService/ValidateMap

# Works with timestamps, durations, any, and nested maps
grpcurl -plaintext -d '{"ts":"2024-01-01T00:00:00Z"}' \
  localhost:50050 validation.ValidationService/ValidateTimestamp
```

### Docker Support

In Docker containers, the descriptor set is pre-generated during the image build:

```dockerfile
# Build stage - generate descriptors
RUN apk add --no-cache protobuf
RUN bun run build && bun run descriptors:generate

# Runtime stage - copy and keep protoc for hot-reload
COPY --from=builder /app/bin/.descriptors.bin ./bin/.descriptors.bin
RUN apk add --no-cache protobuf
```

This ensures:
- ✅ Fast container startup (descriptors pre-baked)
- ✅ Hot-reload support (protoc available at runtime)
- ✅ Zero configuration needed

### Performance Optimization

The server uses mtime-based checking to skip unnecessary descriptor regeneration:
- If `bin/.descriptors.bin` exists and is newer than all proto files → skip regeneration (instant)
- If proto files have been modified → regenerate descriptors automatically
- Typical regeneration time: ~1-2 seconds for full proto set

### Consistency Guarantee

The descriptor generation script **exactly matches** `protoLoader.ts` behavior:
- Auto-discovers all `.proto` files (no hardcoded list)
- Tries bulk compilation first, falls back to one-by-one on error
- Skips protos that fail compilation (same as runtime skip logic)
- **Result:** Reflection always has descriptors for exactly the protos loaded at runtime

## Testing

Run validation tests:

```bash
# Unit tests
bun test tests/validation.ruleExtractor.test.ts
bun test tests/validation.engine.test.ts

# E2E tests with reflection (no -proto flags)
bun run validation:e2e:protovalidate:maps
bun run validation:e2e:protovalidate:bytes
bun run validation:e2e:protovalidate:wkt:timestamp-duration
bun run validation:e2e:protovalidate:wkt:any
```

Note:
- The `wkt:any` E2E script wraps grpcurl calls with a `timeout 15s` and installs a `trap` to ensure the test server is terminated reliably during failures. This avoids CI hangs in edge cases while exercising `google.protobuf.Any`.

See also:
- [PGV Validation Documentation](./pgv-validation.md)
- [Rule Examples](./rule-examples.md)
- [Validation Engine](../src/domain/validation/engine.ts)
- [Rule Extractor](../src/domain/validation/ruleExtractor.ts)
