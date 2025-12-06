# Global Installation Guide

Quick guide for running Wishmock after installing globally with npm.

## Installation

```bash
npm install -g wishmock
```

### Optional: Install protoc

Wishmock auto-detects `protoc` availability. If not found, reflection is disabled but the server runs normally with full validation support.

**Why install protoc?**
- Enables gRPC reflection for `grpcurl list/describe` commands
- Auto-regenerates reflection descriptors on proto changes

**Installation:**
- macOS: `brew install protobuf`
- Ubuntu/Debian: `apt install protobuf-compiler`
- Windows: `choco install protoc` or download from https://github.com/protocolbuffers/protobuf/releases
- Other: https://protobuf.dev/installation/

**Without protoc:**
- Server runs normally ✅
- Validation works ✅
- Request handling works ✅
- Reflection (grpcurl list/describe) may not work ⚠️

## Quick Start

### 1. Create Project Folder

```bash
mkdir my-grpc-mock
cd my-grpc-mock
```

> **Note:** Wishmock creates `protos/`, `rules/grpc/`, and `uploads/` directories in your current working directory. Creating a dedicated project folder keeps your workspace organized.

### 2. Start Server

```bash
wishmock
```

The server will start with:
- **Connect RPC**: `http://localhost:50052` (HTTP/1.1 and HTTP/2)
- **gRPC (plaintext)**: `localhost:50050`
- **gRPC (TLS)**: `localhost:50051` (if certs configured)
- **HTTP Admin API**: `localhost:4319`
- **Web UI**: `http://localhost:4319/app/`

Directories auto-created in current folder:
- `protos/` - Your .proto files
- `rules/grpc/` - Mock rule files
- `uploads/` - Admin API uploads

### 3. Add Your Proto File

**Option A: Via Web UI (Recommended)**

1. Open `http://localhost:4319/app/`
2. Click "Upload Proto"
3. Select your `.proto` file or paste content
4. Click "Upload"

**Option B: Via File System**

Create `protos/helloworld.proto`:

```protobuf
syntax = "proto3";

package helloworld;

service Greeter {
  rpc SayHello (HelloRequest) returns (HelloReply) {}
}

message HelloRequest {
  string name = 1;
}

message HelloReply {
  string message = 1;
}
```

### 4. Add Mock Rule (Optional)

**Via Web UI:**
1. Open `http://localhost:4319/app/`
2. Click "Upload Rule"
3. Filename: `helloworld.greeter.sayhello.yaml`
4. Paste content and upload

**Via File System:**

Create `rules/grpc/helloworld.greeter.sayhello.yaml`:

```yaml
- when:
    request:
      name: "World"
  response:
    message: "Hello World!"
  
- response:
    message: "Hello {{request.name}}!"
```

### 5. Test Your Service

**Using Connect RPC (browser-friendly)**:
```bash
curl -X POST http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Content-Type: application/json" \
  -d '{"name":"World"}'
```

**Using grpcurl (native gRPC)**:
```bash
grpcurl -plaintext -d '{"name":"World"}' localhost:50050 helloworld.Greeter/SayHello
```

**List services**:
```bash
grpcurl -plaintext localhost:50050 list
```

**Check status**:
```bash
curl http://localhost:4319/admin/status
```

## Configuration

### Environment Variables

Create `.env` file in your working directory:

```bash
# Ports
HTTP_PORT=4319                    # Admin API and Web UI
GRPC_PORT_PLAINTEXT=50050         # Native gRPC (plaintext)
GRPC_PORT_TLS=50051               # Native gRPC (TLS)
CONNECT_PORT=50052                # Connect RPC (HTTP/1.1 and HTTP/2)

# Connect RPC
CONNECT_ENABLED=true              # Enable Connect RPC (default: true)
CONNECT_CORS_ENABLED=true         # Enable CORS for browsers (default: true)
CONNECT_CORS_ORIGINS=*            # Allowed origins (default: *)

# TLS (optional)
GRPC_TLS_ENABLED=false
GRPC_TLS_CERT_PATH=certs/server.crt
GRPC_TLS_KEY_PATH=certs/server.key

# Validation
VALIDATION_ENABLED=false
VALIDATION_SOURCE=auto
```

### Custom Paths

By default, Wishmock looks for (and auto-creates if missing):
- Protos: `./protos/`
- Rules: `./rules/grpc/`

These paths are relative to your current working directory.

> **Tip:** You don't need to manually create these directories. Just run `wishmock` and they'll be created automatically.

## MCP Server (Model Context Protocol)

Run Wishmock as an MCP server for AI assistants:

```bash
# Stdio transport (for Claude Desktop, etc.)
wishmock-mcp

# Or use environment variables
WISHMOCK_RULES_DIR=./rules/grpc \
WISHMOCK_PROTOS_DIR=./protos \
wishmock-mcp
```

### MCP Configuration Example

For Claude Desktop, add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wishmock": {
      "command": "wishmock-mcp",
      "env": {
        "WISHMOCK_RULES_DIR": "/path/to/your/rules/grpc",
        "WISHMOCK_PROTOS_DIR": "/path/to/your/protos",
        "ADMIN_BASE_URL": "http://localhost:4319"
      }
    }
  }
}
```

## Admin API

### Upload Proto

```bash
curl -X POST http://localhost:4319/admin/upload/proto \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "myservice.proto",
    "content": "syntax = \"proto3\"; ..."
  }'
```

### Upload Rule

```bash
curl -X POST http://localhost:4319/admin/upload/rule/grpc \
  -H "Content-Type: application/json" \
  -d '{
    "filename": "myservice.method.yaml",
    "content": "- response:\n    status: ok"
  }'
```

### List Services

```bash
curl http://localhost:4319/admin/services
```

### Get Schema

```bash
curl http://localhost:4319/admin/schema/helloworld.HelloRequest
```

## Hot Reload

Wishmock automatically reloads when you:
- Add/modify/delete `.proto` files in `protos/`
- Add/modify/delete rule files in `rules/grpc/`

No restart needed!

## Directory Structure

Wishmock automatically creates these directories on first run:

```
my-mock-server/
├── protos/              # Your .proto files (auto-created)
│   ├── helloworld.proto
│   └── myservice.proto
├── rules/
│   └── grpc/           # Mock rules (auto-created)
│       ├── helloworld.greeter.sayhello.yaml
│       └── myservice.method.yaml
├── uploads/            # Auto-created for Admin API uploads
├── .env               # Optional configuration (you create this)
└── certs/             # Optional TLS certificates (you create this)
    ├── server.crt
    ├── server.key
    └── ca.crt
```

## Connect RPC Support

Wishmock includes **Connect RPC** support, enabling native browser clients without proxies like Envoy. A single HTTP endpoint handles three protocols:

- **Connect Protocol** - Modern RPC with JSON and binary formats
- **gRPC-Web** - Browser-compatible gRPC
- **gRPC** - Full compatibility with standard gRPC clients

### Quick Test

**Browser-friendly JSON request**:
```bash
curl -X POST http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Content-Type: application/json" \
  -d '{"name":"World"}'
```

**Check Connect RPC status**:
```bash
curl http://localhost:4319/admin/status | jq '.connect_rpc'
```

### Browser Client Example

```javascript
import { createPromiseClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { Greeter } from "./gen/helloworld_connect";

const transport = createConnectTransport({
  baseUrl: "http://localhost:50052",
});

const client = createPromiseClient(Greeter, transport);
const response = await client.sayHello({ name: "World" });
console.log(response.message);
```

For complete Connect RPC documentation, see [docs/connect-rpc-support.md](./connect-rpc-support.md).

## Common Use Cases

### 1. Development Mock Server

```bash
# Start with validation enabled
VALIDATION_ENABLED=true wishmock
```

### 2. Browser Development (Connect RPC)

```bash
# Enable CORS for local development
CONNECT_ENABLED=true \
CONNECT_CORS_ENABLED=true \
CONNECT_CORS_ORIGINS=http://localhost:3000 \
wishmock
```

### 3. Testing with Custom Ports

```bash
HTTP_PORT=8080 \
GRPC_PORT_PLAINTEXT=9090 \
CONNECT_PORT=8081 \
wishmock
```

### 4. Production-like with TLS

```bash
GRPC_TLS_ENABLED=true \
GRPC_TLS_CERT_PATH=./certs/server.crt \
GRPC_TLS_KEY_PATH=./certs/server.key \
wishmock
```

### 5. CI/CD Integration

```bash
# Start in background
wishmock &
WISHMOCK_PID=$!

# Wait for ready
sleep 3

# Run tests (Connect RPC)
curl -f http://localhost:50052/helloworld.Greeter/SayHello \
  -H "Content-Type: application/json" \
  -d '{"name":"Test"}'

# Run tests (native gRPC)
grpcurl -plaintext localhost:50050 list

# Cleanup
kill $WISHMOCK_PID
```

## Troubleshooting

### Port Already in Use

```bash
# Use different ports
HTTP_PORT=4320 GRPC_PORT_PLAINTEXT=50051 wishmock
```

### Proto Load Errors

Check status endpoint:
```bash
curl http://localhost:4319/admin/status | jq '.protos.skipped'
```

### Reflection Not Working (grpcurl list fails)

If you see:
```
Failed to list services: server does not support the reflection API
```

**Cause:** `protoc` is not installed or reflection regeneration is disabled.

**Solution:**
1. Install protoc (see Installation section above)
2. Restart wishmock (it will auto-detect protoc)
3. Or manually enable: `REFLECTION_DISABLE_REGEN=0 wishmock`

**Note:** Wishmock automatically sets `REFLECTION_DISABLE_REGEN=1` if protoc is not found. This allows the server to run without protoc, but disables reflection.

### No Services Loaded

Ensure:
1. At least one `.proto` file exists in `protos/`
2. Proto files have valid syntax
3. Check logs for errors

### Rule Not Applied

Rule filename must match pattern:
```
package.service.method.yaml
```

Example: `helloworld.greeter.sayhello.yaml`

## Advanced Features

### Validation (Protovalidate/PGV)

```bash
VALIDATION_ENABLED=true \
VALIDATION_SOURCE=protovalidate \
wishmock
```

### Streaming Support

Wishmock supports all gRPC streaming modes:
- Unary
- Server streaming
- Client streaming  
- Bidirectional streaming

### Metadata Matching

Rules can match on gRPC metadata:

```yaml
- when:
    metadata:
      authorization: "Bearer token123"
  response:
    status: "authenticated"
```

## Links

- Full Documentation: [README.md](../README.md)
- Admin API Reference: [API.md](../API.md)
- Connect RPC Guide: [connect-rpc-support.md](./connect-rpc-support.md)
- Rule Examples: [rule-examples.md](./rule-examples.md)
- Validation Guide: [pgv-validation.md](./pgv-validation.md)
- GitHub: https://github.com/lukmanbaidhowi/wishmock
- npm: https://www.npmjs.com/package/wishmock

## Getting Help

```bash
# Check version
wishmock --version

# View help (if implemented)
wishmock --help
```

For issues and questions, visit the GitHub repository.
