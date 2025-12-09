# Wishmock - gRPC Mock Server

[![npm version](https://img.shields.io/npm/v/wishmock.svg)](https://www.npmjs.com/package/wishmock)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A powerful gRPC and Connect RPC mock server with hot reload, rule-based responses, built-in validation, and native gRPC-Web support without requiring an additional proxy layer.

## Quick Start

```bash
# Install globally
npm install -g wishmock

# Create project folder
mkdir my-grpc-mock && cd my-grpc-mock

# Start server (auto-creates protos/, rules/grpc/, uploads/ in current directory)
wishmock
```

Server runs on:
- Connect RPC: `http://localhost:50052` (HTTP/1.1 and HTTP/2, enabled by default)
- gRPC: `localhost:50050`
- Admin API: `http://localhost:4319`
- Web UI: `http://localhost:4319/app/`

**Add your proto via Web UI:**

1. Open `http://localhost:4319/app/`
2. Upload your `.proto` file
3. Start testing!

Test it:
```bash
# List services
grpcurl -plaintext localhost:50050 list

# Call method
grpcurl -plaintext -d '{"name":"World"}' localhost:50050 hello.Greeter/SayHello
```

## Features

✅ **Zero Config** - Drop proto files and start mocking  
✅ **Hot Reload** - Auto-reload on proto/rule changes  
✅ **Rule Engine** - YAML/JSON rules with templating  
✅ **Validation** - Protovalidate & PGV support  
✅ **Streaming** - All gRPC streaming modes  
✅ **Connect RPC** - Native browser support (Connect, gRPC-Web, gRPC) without additional proxy layer  
✅ **TLS/mTLS** - Production-ready security  
✅ **Admin API** - REST endpoints for automation  
✅ **Web UI** - Browser-based management  
✅ **MCP Server** - AI assistant integration  
✅ **Docker Ready** - Multi-stage builds included

## Mock Rules

Create `rules/grpc/hello.greeter.sayhello.yaml`:

```yaml
# Conditional response
- when:
    request:
      name: "Alice"
  response:
    message: "Hello Alice!"

# Template response (default)
- response:
    message: "Hello {{request.name}}!"
```

## Commands

```bash
wishmock              # Start server
wishmock --version    # Show version
wishmock --help       # Show help
wishmock-mcp          # Start MCP server
```

## Environment Variables

```bash
HTTP_PORT=3000                # Admin API port
GRPC_PORT_PLAINTEXT=50050     # gRPC port
CONNECT_ENABLED=true          # Enable Connect RPC (default: true)
CONNECT_PORT=50052            # Connect RPC port (default: 50052)
VALIDATION_ENABLED=true       # Enable validation
GRPC_TLS_ENABLED=true         # Enable TLS
```

## Admin API

```bash
# Upload proto
curl -X POST http://localhost:4319/admin/upload/proto \
  -H "Content-Type: application/json" \
  -d '{"filename":"my.proto","content":"..."}'

# Get status
curl http://localhost:4319/admin/status

# List services
curl http://localhost:4319/admin/services
```

## Use Cases

- **Development** - Mock backend services during frontend development
- **Testing** - Simulate various scenarios and edge cases
- **CI/CD** - Automated integration testing
- **Demos** - Showcase APIs without backend infrastructure
- **Prototyping** - Rapid API design iteration

## Documentation

- [Global Installation Guide](https://github.com/lukmanbaidhowi/wishmock/blob/main/docs/global-installation.md)
- [Quick Reference](https://github.com/lukmanbaidhowi/wishmock/blob/main/docs/quick-reference.md)
- [Full Documentation](https://github.com/lukmanbaidhowi/wishmock/blob/main/README.md)
- [Rule Examples](https://github.com/lukmanbaidhowi/wishmock/blob/main/docs/rule-examples.md)
- [Admin API Reference](https://github.com/lukmanbaidhowi/wishmock/blob/main/API.md)

## Advanced Features

### Streaming

```yaml
# Server streaming
- response:
    stream:
      - message: "First"
        delay_ms: 100
      - message: "Second"
      - message: "Third"
```

### Validation

```protobuf
import "buf/validate/validate.proto";

message Request {
  string name = 1 [(buf.validate.field).string.min_len = 1];
}
```

Enable: `VALIDATION_ENABLED=true wishmock`

### Error Simulation

```yaml
- when:
    request:
      name: "error"
  error:
    code: 3  # INVALID_ARGUMENT
    message: "Invalid request"
```

### Metadata Matching

```yaml
- when:
    metadata:
      authorization: "Bearer token"
  response:
    status: "authenticated"
```

## Docker

```bash
# Pull image
docker pull lukmanbaidhowi/wishmock:latest

# Run
docker run -p 50050:50050 -p 4319:4319 \
  -v $(pwd)/protos:/app/protos \
  -v $(pwd)/rules:/app/rules \
  lukmanbaidhowi/wishmock:latest
```

## MCP Integration

For AI assistants (Claude, etc.):

```json
{
  "mcpServers": {
    "wishmock": {
      "command": "wishmock-mcp",
      "env": {
        "WISHMOCK_PROTOS_DIR": "/path/to/protos",
        "WISHMOCK_RULES_DIR": "/path/to/rules"
      }
    }
  }
}
```

## Requirements

- Node.js ≥ 18 (or Bun ≥ 1.0)
- protoc (optional, for grpcurl reflection - auto-detected)
- grpcurl (optional, for testing)

**Note:** If `protoc` is not installed, the server automatically disables reflection descriptor regeneration. The server will run normally with full validation support, but `grpcurl list/describe` commands may not work.

**Install protoc (optional):**
- macOS: `brew install protobuf`
- Ubuntu/Debian: `apt install protobuf-compiler`
- Windows: `choco install protoc` or download from [releases](https://github.com/protocolbuffers/protobuf/releases)
- More info: https://protobuf.dev/installation/

## License

MIT

## Links

- GitHub: https://github.com/lukmanbaidhowi/wishmock
- Issues: https://github.com/lukmanbaidhowi/wishmock/issues
- npm: https://www.npmjs.com/package/wishmock
