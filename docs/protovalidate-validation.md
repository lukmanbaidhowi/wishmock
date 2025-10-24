# Protovalidate Validation Support

This mock gRPC server now supports **Protovalidate** (formerly PGV v2) validation in addition to PGV (Protoc Gen Validate).

## Overview

Protovalidate allows you to define validation rules directly in your `.proto` files using the `buf.validate.field` extension. The validation engine automatically extracts and enforces these rules at runtime.

## Quick Start

### 1. Import Buf Validation Proto

```protobuf
import "buf/validate/validate.proto";
```

### 2. Add Validation Annotations

Add validation constraints to your message fields:

```protobuf
message User {
  string first_name = 1 [
    (buf.validate.field).string_val = {
      min_len: 1,
      max_len: 50
    }
  ];
  
  string email = 2 [
    (buf.validate.field).string_val = {
      email: true
    }
  ];
  
  int32 age = 3 [
    (buf.validate.field).int_val = {
      gte: 0,
      lte: 150
    }
  ];
  
  repeated string tags = 4 [
    (buf.validate.field).repeated_val = {
      min_items: 1,
      max_items: 10
    }
  ];
}
```

## Supported Constraints

### String Constraints (`string_val`)

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

### Number Constraints (`int_val`, `double_val`, `uint_val`)

- `const: int64/double/uint64` - Value must equal this constant
- `gt: int64/double/uint64` - Greater than
- `gte: int64/double/uint64` - Greater than or equal
- `lt: int64/double/uint64` - Less than
- `lte: int64/double/uint64` - Less than or equal

### Repeated Constraints (`repeated_val`)

- `min_items: int32` - Minimum number of items
- `max_items: int32` - Maximum number of items
- `unique: bool` - All items must be unique

### Message Constraints (`message_val`)

- `required: bool` - Field is required (must be present)

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

### Email Validation

```protobuf
message SignupRequest {
  string email = 1 [
    (buf.validate.field).string_val = {
      email: true,
      max_len: 254
    }
  ];
}
```

### Numeric Range

```protobuf
message PaginationRequest {
  int32 page_size = 1 [
    (buf.validate.field).int_val = {
      gte: 1,
      lte: 100
    }
  ];
}
```

### List Validation

```protobuf
message BatchRequest {
  repeated string ids = 1 [
    (buf.validate.field).repeated_val = {
      min_items: 1,
      max_items: 1000,
      unique: true
    }
  ];
}
```

## PGV vs Protovalidate

The validation engine supports both PGV and Protovalidate validation:

| Feature | PGV | Protovalidate |
|---------|-----|-----|
| Syntax | `(validate.rules)` | `(buf.validate.field)` |
| String rules | Nested object | Type suffix (`.string_val`) |
| Number rules | Type suffix (`.int32`, `.float`, etc.) | Type suffix (`.int_val`, `.double_val`) |
| Status | Fully supported | Fully supported |

If a field has both PGV and Protovalidate annotations, **Protovalidate takes precedence**.

## Testing

Run validation tests:

```bash
bun test tests/validation.ruleExtractor.test.ts
```

See also:
- [PGV Validation Documentation](./pgv-validation.md)
- [Rule Examples](./rule-examples.md)
- [Validation Engine](../src/domain/validation/engine.ts)
- [Rule Extractor](../src/domain/validation/ruleExtractor.ts)
