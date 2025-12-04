# Wishmock Quick Reference

## Installation

```bash
npm install -g wishmock
```

## Basic Commands

```bash
# Start server (auto-creates protos/, rules/grpc/, uploads/)
wishmock

# Show version
wishmock --version

# Show help
wishmock --help

# Start MCP server
wishmock-mcp
```

## Quick Start

```bash
# 1. Install
npm install -g wishmock

# 2. Create project folder
mkdir my-grpc-mock && cd my-grpc-mock

# 3. Start (auto-creates protos/, rules/grpc/, uploads/ in current directory)
wishmock

# 4. Add proto via Web UI
# Open http://localhost:4319/app/ and upload your .proto file

# 5. Test
grpcurl -plaintext localhost:50050 list
```

## Default Ports

| Service | Port | URL |
|---------|------|-----|
| gRPC (plaintext) | 50050 | `localhost:50050` |
| gRPC (TLS) | 50051 | `localhost:50051` |
| HTTP Admin API | 4319 | `http://localhost:4319` |
| Web UI | 4319 | `http://localhost:4319/app/` |

## Directory Structure

All directories are auto-created by Wishmock on first run:

```
your-project/
├── protos/              # .proto files (auto-created)
├── rules/grpc/          # rule files (auto-created)
└── uploads/             # admin uploads (auto-created)
```

## Environment Variables

```bash
# Ports
HTTP_PORT=3000
GRPC_PORT_PLAINTEXT=50050
GRPC_PORT_TLS=50051

# TLS
GRPC_TLS_ENABLED=true
GRPC_TLS_CERT_PATH=certs/server.crt
GRPC_TLS_KEY_PATH=certs/server.key

# Features
VALIDATION_ENABLED=true
HOT_RELOAD_PROTOS=true
HOT_RELOAD_RULES=true
```

## Rule File Naming

Pattern: `package.service.method.yaml`

Examples:
- `helloworld.greeter.sayhello.yaml`
- `shop.shopservice.createorder.yaml`

## Basic Rule Structure

```yaml
# Simple response
- response:
    message: "Hello World"

# Conditional response
- when:
    request:
      name: "Alice"
  response:
    message: "Hello Alice!"

# Template response
- response:
    message: "Hello {{request.name}}!"

# Error response
- when:
    request:
      name: "error"
  error:
    code: 3  # INVALID_ARGUMENT
    message: "Invalid name"
```

## Testing Commands

```bash
# List services
grpcurl -plaintext localhost:50050 list

# Describe service
grpcurl -plaintext localhost:50050 describe helloworld.Greeter

# Call method
grpcurl -plaintext -d '{"name":"World"}' \
  localhost:50050 helloworld.Greeter/SayHello

# Check status
curl http://localhost:4319/admin/status

# List services via API
curl http://localhost:4319/admin/services

# Get schema
curl http://localhost:4319/admin/schema/helloworld.HelloRequest
```

## Admin API Endpoints

```bash
# Upload proto
curl -X POST http://localhost:4319/admin/upload/proto \
  -H "Content-Type: application/json" \
  -d '{"filename":"my.proto","content":"syntax = \"proto3\"; ..."}'

# Upload rule
curl -X POST http://localhost:4319/admin/upload/rule/grpc \
  -H "Content-Type: application/json" \
  -d '{"filename":"my.rule.yaml","content":"- response: {}"}'

# Delete proto
curl -X DELETE http://localhost:4319/admin/proto/my.proto

# Delete rule
curl -X DELETE http://localhost:4319/admin/rule/grpc/my.rule.yaml

# Health checks
curl http://localhost:4319/
curl http://localhost:4319/liveness
curl http://localhost:4319/readiness
```

## gRPC Status Codes

| Code | Name | Usage |
|------|------|-------|
| 0 | OK | Success |
| 1 | CANCELLED | Operation cancelled |
| 2 | UNKNOWN | Unknown error |
| 3 | INVALID_ARGUMENT | Invalid request |
| 4 | DEADLINE_EXCEEDED | Timeout |
| 5 | NOT_FOUND | Resource not found |
| 7 | PERMISSION_DENIED | Access denied |
| 16 | UNAUTHENTICATED | Not authenticated |

## Template Variables

```yaml
# Request fields
{{request.fieldName}}

# Metadata
{{metadata.authorization}}

# Random values
{{random.uuid}}
{{random.number}}
{{random.string}}

# Timestamps
{{timestamp.now}}
{{timestamp.iso}}
```

## Streaming Rules

```yaml
# Server streaming
- response:
    stream:
      - message: "First"
        delay_ms: 100
      - message: "Second"
        delay_ms: 100
      - message: "Third"

# Infinite loop
- response:
    stream:
      - message: "Tick"
        delay_ms: 1000
    loop: true
```

## Validation

```protobuf
// Protovalidate
import "buf/validate/validate.proto";

message HelloRequest {
  string name = 1 [(buf.validate.field).string.min_len = 1];
}

// PGV (legacy)
import "validate/validate.proto";

message HelloRequest {
  string name = 1 [(validate.rules).string.min_len = 1];
}
```

Enable validation:
```bash
VALIDATION_ENABLED=true wishmock
```

## Common Patterns

### Match by metadata
```yaml
- when:
    metadata:
      authorization: "Bearer token123"
  response:
    status: "authenticated"
```

### Match by nested field
```yaml
- when:
    request:
      user.id: 123
  response:
    name: "John Doe"
```

### Multiple conditions
```yaml
- when:
    request:
      status: "active"
      role: "admin"
  response:
    access: "granted"
```

### Array contains
```yaml
- when:
    request:
      tags:
        $contains: "premium"
  response:
    discount: 20
```

### Regex match
```yaml
- when:
    request:
      email:
        $regex: ".*@example\\.com$"
  response:
    domain: "example.com"
```

## Troubleshooting

### Port in use
```bash
HTTP_PORT=4320 GRPC_PORT_PLAINTEXT=50051 wishmock
```

### Proto not loading
```bash
curl http://localhost:4319/admin/status | jq '.protos.skipped'
```

### Rule not matching
- Check filename: `package.service.method.yaml`
- Check YAML syntax
- Check field names match proto
- View logs for matching details

### No services loaded
- Ensure `.proto` files exist in `protos/`
- Check proto syntax
- View status: `curl http://localhost:4319/admin/status`

## Links

- [Full Documentation](../README.md)
- [Global Installation Guide](./global-installation.md)
- [Admin API Reference](../API.md)
- [Rule Examples](./rule-examples.md)
- [Validation Guide](./pgv-validation.md)
