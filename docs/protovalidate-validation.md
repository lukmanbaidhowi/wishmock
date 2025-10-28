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

## Testing

Run validation tests:

```bash
bun test tests/validation.ruleExtractor.test.ts

# Additional engine tests for new types
bun test tests/validation.engine.test.ts
```

See also:
- [PGV Validation Documentation](./pgv-validation.md)
- [Rule Examples](./rule-examples.md)
- [Validation Engine](../src/domain/validation/engine.ts)
- [Rule Extractor](../src/domain/validation/ruleExtractor.ts)
