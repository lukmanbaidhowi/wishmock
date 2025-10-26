# PGV (Protoc Gen Validate) Support

This mock gRPC server supports **PGV (Protoc Gen Validate)** validation in addition to Buf validation.

Enable with env:
- `VALIDATION_ENABLED=true`
- `VALIDATION_SOURCE=pgv` (PGV-only) or `auto` (Protovalidate preferred, PGV fallback)
- Optional: `VALIDATION_MODE=per_message|aggregate` (default `per_message`)
Note: Message-level CEL is gated globally via `VALIDATION_CEL_MESSAGE` and applies to Protovalidate only.

## Overview

PGV allows you to define validation rules directly in your `.proto` files using the `validate.rules` extension. The validation engine automatically extracts and enforces these rules at runtime.

## Quick Start

### 1. Import PGV Validation Proto

```protobuf
import "validate/validate.proto";
```

### 2. Add Validation Annotations

Add validation constraints to your message fields:

```protobuf
message User {
  string first_name = 1 [
    (validate.rules).string = {
      min_len: 1,
      max_len: 50
    }
  ];
  
  string email = 2 [
    (validate.rules).string.email = true
  ];
  
  int32 age = 3 [
    (validate.rules).int32 = {
      gte: 0,
      lte: 150
    }
  ];
  
  repeated string tags = 4 [
    (validate.rules).repeated = {
      min_items: 1,
      max_items: 10
    }
  ];
}
```

## Supported Constraints

### String Constraints (`string`)

- `const: string` - Must equal this exact value
- `len: uint64` - Exact string length (character count)
- `min_len: uint64` - Minimum string length
- `max_len: uint64` - Maximum string length
- `len_bytes: uint64` - Exact byte length (UTF-8)
- `min_bytes: uint64` - Minimum byte length
- `max_bytes: uint64` - Maximum byte length
- `pattern: string` - RE2 regex pattern to match
- `email: bool` - Must be valid email address
- `hostname: bool` - Must be valid hostname
- `ipv4: bool` - Must be valid IPv4 address
- `ipv6: bool` - Must be valid IPv6 address
- `ip: bool` - Must be valid IPv4 or IPv6 address
- `uri: bool` - Must be valid URI
- `uri_ref: bool` - Must be valid URI reference
- `uuid: bool` - Must be valid UUID
- `prefix: string` - Must start with this prefix
- `suffix: string` - Must end with this suffix
- `contains: string` - Must contain this substring
- `not_contains: string` - Must not contain this substring
- `in: repeated string` - Must be one of these values
- `not_in: repeated string` - Must not be any of these values

### Number Constraints

#### Int32, Int64, Sint32, Sint64, Sfixed32, Sfixed64

```protobuf
[(validate.rules).int32 = { ... }]
[(validate.rules).int64 = { ... }]
[(validate.rules).sint32 = { ... }]
// etc.
```

Supported rules:
- `const: int64` - Must equal this constant
- `lt: int64` - Less than
- `lte: int64` - Less than or equal
- `gt: int64` - Greater than
- `gte: int64` - Greater than or equal
- `in: repeated int64` - Must be one of these values
- `not_in: repeated int64` - Must not be any of these values

#### Uint32, Uint64, Fixed32, Fixed64

Same rules as integer types, using unsigned values.

#### Float, Double

```protobuf
[(validate.rules).float = { ... }]
[(validate.rules).double = { ... }]
```

Supported rules:
- `const: double` - Must equal this constant
- `lt: double` - Less than
- `lte: double` - Less than or equal
- `gt: double` - Greater than
- `gte: double` - Greater than or equal
- `in: repeated double` - Must be one of these values
- `not_in: repeated double` - Must not be any of these values

### Boolean Constraints

```protobuf
[(validate.rules).bool.const = true/false]
```

### Repeated Constraints

```protobuf
[(validate.rules).repeated = { ... }]
```

Supported rules:
- `min_items: int32` - Minimum number of items
- `max_items: int32` - Maximum number of items
- `unique: bool` - All items must be unique

### Message Constraints

```protobuf
[(validate.rules).message = { ... }]
```

Supported rules:
- `required: bool` - Field is required (must be present)
- `skip: bool` - Skip validation for this message

### Enum Constraints

```protobuf
[(validate.rules).enum.defined_only = true]
```

## Field-Level Validation Rules

### Message-Level Validation

Disable validation for an entire message:

```protobuf
message SkipValidation {
  option (validate.disabled) = true;
}
```

Ignore generation of validation (message is still validated):

```protobuf
message IgnoreValidation {
  option (validate.ignored) = true;
}
```

### OneOf Requirement

Make exactly one field in a oneof required:

```protobuf
message OneofExample {
  oneof settings {
    option (validate.required) = true;
    OptionA option_a = 1;
    OptionB option_b = 2;
  }
}
```

## Examples

### Email and Length Validation

```protobuf
message SignupRequest {
  string email = 1 [
    (validate.rules).string = {
      email: true,
      max_len: 254
    }
  ];
  
  string username = 2 [
    (validate.rules).string = {
      min_len: 3,
      max_len: 30,
      pattern: "^[a-zA-Z0-9_]+$"
    }
  ];
}
```

### Numeric Range Validation

```protobuf
message PaginationRequest {
  int32 page = 1 [
    (validate.rules).int32 = {
      gte: 1
    }
  ];
  
  int32 page_size = 2 [
    (validate.rules).int32 = {
      gte: 1,
      lte: 100
    }
  ];
}
```

### List and Uniqueness Validation

```protobuf
message BatchRequest {
  repeated string ids = 1 [
    (validate.rules).repeated = {
      min_items: 1,
      max_items: 1000,
      unique: true
    }
  ];
}
```

### IP Address Validation

```protobuf
message ServerConfig {
  string ipv4_address = 1 [
    (validate.rules).string.ipv4 = true
  ];
  
  string ipv6_address = 2 [
    (validate.rules).string.ipv6 = true
  ];
  
  string hostname = 3 [
    (validate.rules).string.hostname = true
  ];
}
```

### Enum In/Out Constraints

```protobuf
message EnumFilterRequest {
  repeated Status allowed_statuses = 1 [
    (validate.rules).enum = {
      in: [1, 2, 3]
    }
  ];
  
  repeated Status blocked_statuses = 2 [
    (validate.rules).enum = {
      not_in: [0]
    }
  ];
}
```

### URI and UUID Validation

```protobuf
message ResourceRequest {
  string resource_uri = 1 [
    (validate.rules).string.uri = true
  ];
  
  string correlation_id = 2 [
    (validate.rules).string.uuid = true
  ];
}
```

### String Pattern Matching

```protobuf
message CodeRequest {
  string product_code = 1 [
    (validate.rules).string = {
      pattern: "^[A-Z]{3}-\\d{4}$"
    }
  ];
  
  string phone = 2 [
    (validate.rules).string = {
      pattern: "^\\+?[1-9]\\d{1,14}$"
    }
  ];
}
```

### Prefix and Suffix Validation

```protobuf
message ConfigRequest {
  string env_var = 1 [
    (validate.rules).string = {
      prefix: "APP_"
    }
  ];
  
  string file_path = 2 [
    (validate.rules).string = {
      suffix: ".conf"
    }
  ];
}
```

### String Set Constraints (In/NotIn)

```protobuf
message ColorRequest {
  string color = 1 [
    (validate.rules).string = {
      in: ["red", "green", "blue", "yellow"]
    }
  ];
  
  string reserved_word = 2 [
    (validate.rules).string = {
      not_in: ["admin", "root", "system"]
    }
  ];
}
```

### Required Nested Message

```protobuf
message OrderRequest {
  CustomerInfo customer = 1 [
    (validate.rules).message.required = true
  ];
  
  repeated OrderItem items = 2 [
    (validate.rules).repeated = {
      min_items: 1
    }
  ];
}

message CustomerInfo {
  string name = 1;
  string email = 2;
}

message OrderItem {
  string product_id = 1;
  int32 quantity = 2;
}
```

## PGV vs Buf

| Feature | PGV | Buf |
|---------|-----|-----|
| Syntax | `(validate.rules)` | `(buf.validate.field)` |
| String rules | Direct object | Type suffix (`.string_val`) |
| Number rules | Type suffix (`.int32`, `.float`, etc.) | Type suffix (`.int_val`, `.double_val`) |
| Repeated rules | `(validate.rules).repeated` | `(buf.validate.field).repeated_val` |
| Status | Fully supported | Fully supported |

Source selection rules:
- With `VALIDATION_SOURCE=pgv`, only PGV rules are enforced; Protovalidate rules are ignored.
- With `VALIDATION_SOURCE=protovalidate`, only Protovalidate rules are enforced; PGV rules are ignored.
- With `VALIDATION_SOURCE=auto` (default), Protovalidate takes precedence; if no Protovalidate rule is present, PGV is used as fallback.

## Error Messages

When validation fails, the server returns a `Code: InvalidArgument` error with detailed field violation information:

```
ERROR:
  Code: InvalidArgument
  Message: {
    "reason":"validation_failed",
    "field_violations":[
      {
        "field":"email",
        "description":"must be a valid email address",
        "rule":"email"
      }
    ]
  }
```

## Testing

Run validation tests:

```bash
bun test tests/validation.ruleExtractor.test.ts
bun test tests/validation.engine.test.ts
```

Run comprehensive E2E tests:

```bash
bash scripts/test-validation-comprehensive.sh
```

## See Also

- [Buf Validation Documentation](./buf-validation.md)
- [Rule Examples](./rule-examples.md)
- [Validation Engine](../src/domain/validation/engine.ts)
- [Rule Extractor](../src/domain/validation/ruleExtractor.ts)
- [PGV GitHub Repository](https://github.com/envoyproxy/protoc-gen-validate)
